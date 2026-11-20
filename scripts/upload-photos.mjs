#!/usr/bin/env node

/**
 * Bulk Student Photo Upload Script
 * Usage: node scripts/upload-photos.mjs --dir ./photos [--dry-run] [--overwrite] [--concurrency 5]
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { matchFilesToStudents } from './lib/match.mjs';

// Load environment variables from .env.local only (never commit secrets)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Parse CLI Arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dir: null,
    dryRun: false,
    overwrite: false,
    concurrency: 5
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dir' || arg === '-d') {
      options.dir = args[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (arg === '--concurrency' || arg === '-c') {
      options.concurrency = parseInt(args[++i], 10) || 5;
    }
  }

  return options;
}

// Simple native concurrent executor
async function pMap(items, fn, concurrency = 5) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// Fetch all students in batches of 1000
async function fetchAllStudents(supabase) {
  const PAGE_SIZE = 1000;
  let allStudents = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('students')
      .select('id, roll_no, stud_id, name, program, year, section, photo_path')
      .range(from, to)
      .order('id', { ascending: true });

    if (error) {
      throw new Error(`Failed to query students from database: ${error.message}`);
    }

    if (data && data.length > 0) {
      allStudents.push(...data);
      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    } else {
      hasMore = false;
    }
  }

  return allStudents;
}

// Retry with exponential backoff
async function uploadWithRetry(supabase, studentId, buffer, maxRetries = 3) {
  const photoPath = `students/${studentId}.jpg`;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('student-photos')
        .upload(photoPath, buffer, {
          upsert: true,
          contentType: 'image/jpeg',
          cacheControl: '3600'
        });

      if (uploadError) throw new Error(`Storage upload error: ${uploadError.message}`);

      // 2. Update database record
      const now = new Date().toISOString();
      const { error: dbError } = await supabase
        .from('students')
        .update({ photo_path: photoPath, photo_updated_at: now })
        .eq('id', studentId);

      if (dbError) throw new Error(`Database update error: ${dbError.message}`);

      return { photoPath, photo_updated_at: now };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const options = parseArgs();

  console.log('====================================================');
  console.log('📷 SYNERGY 2026 — BULK STUDENT PHOTO UPLOAD');
  console.log('====================================================');

  if (!options.dir) {
    console.error('❌ Error: Missing required --dir parameter.');
    console.error('Usage: node scripts/upload-photos.mjs --dir ./photos [--dry-run] [--overwrite] [--concurrency 5]');
    process.exit(1);
  }

  const photosDir = path.resolve(process.cwd(), options.dir);
  if (!fs.existsSync(photosDir)) {
    console.error(`❌ Error: Directory not found at: ${photosDir}`);
    process.exit(1);
  }

  console.log(`Directory:   ${photosDir}`);
  console.log(`Mode:        ${options.dryRun ? 'DRY-RUN (No uploads will be performed)' : 'LIVE UPLOAD'}`);
  console.log(`Overwrite:   ${options.overwrite ? 'YES' : 'NO'}`);
  console.log(`Concurrency: ${options.concurrency}`);
  console.log('----------------------------------------------------');

  if (!options.dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
    console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    console.error('Please configure .env.local with your service-role credentials before uploading.');
    process.exit(1);
  }

  // Read all files from target directory
  const allFilesInDir = fs.readdirSync(photosDir);
  console.log(`Found ${allFilesInDir.length} total files in directory.`);

  let students = [];
  let supabase = null;

  if (SUPABASE_URL && (SUPABASE_SERVICE_ROLE_KEY || options.dryRun)) {
    try {
      const key = SUPABASE_SERVICE_ROLE_KEY || 'dummy_key_for_dry_run';
      supabase = createClient(SUPABASE_URL, key, {
        auth: { persistSession: false }
      });
      console.log('Connecting to Supabase and fetching student records...');
      students = await fetchAllStudents(supabase);
      console.log(`Fetched ${students.length} student records from database.`);
    } catch (err) {
      console.warn(`⚠️ Warning connecting to Supabase: ${err.message}`);
      if (!options.dryRun) {
        process.exit(1);
      }
    }
  }

  // Perform matching using pure logic from match.mjs
  const { results, missingStudents, summary } = matchFilesToStudents(allFilesInDir, students, {
    overwrite: options.overwrite
  });

  const finalReports = [];
  let failCount = 0;

  // Process and upload
  await pMap(
    results,
    async (match) => {
      const filePath = path.join(photosDir, match.file);

      if (match.status !== 'matched') {
        finalReports.push({
          file: match.file,
          status: match.status,
          student_id: match.student?.id || '',
          matched_by: match.matchedBy || '',
          bytes: 0,
          message: match.message
        });
        return;
      }

      try {
        const stat = fs.statSync(filePath);

        // Process with sharp: rotate EXIF, 400x400 cover, JPEG 82
        const processedBuffer = await sharp(filePath)
          .rotate()
          .resize(400, 400, { fit: 'cover' })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();

        if (options.dryRun) {
          finalReports.push({
            file: match.file,
            status: 'matched (dry-run)',
            student_id: match.student.id,
            matched_by: match.matchedBy,
            bytes: processedBuffer.length,
            message: `Ready to upload (${Math.round(processedBuffer.length / 1024)} KB)`
          });
          return;
        }

        // Live Upload
        await uploadWithRetry(supabase, match.student.id, processedBuffer, 3);

        finalReports.push({
          file: match.file,
          status: 'success',
          student_id: match.student.id,
          matched_by: match.matchedBy,
          bytes: processedBuffer.length,
          message: `Uploaded (${Math.round(processedBuffer.length / 1024)} KB)`
        });
      } catch (err) {
        failCount++;
        finalReports.push({
          file: match.file,
          status: 'failed',
          student_id: match.student?.id || '',
          matched_by: match.matchedBy || '',
          bytes: 0,
          message: err.message
        });
      }
    },
    options.concurrency
  );

  // 1. Write photo-upload-report.csv
  const reportCsvPath = path.resolve(process.cwd(), 'photo-upload-report.csv');
  const reportHeaders = ['file', 'status', 'student_id', 'matched_by', 'bytes', 'message'];
  const reportRows = finalReports.map(r =>
    [r.file, r.status, r.student_id, r.matched_by, r.bytes, r.message].map(escapeCsv).join(',')
  );
  fs.writeFileSync(reportCsvPath, [reportHeaders.join(','), ...reportRows].join('\n'), 'utf8');

  // 2. Write missing-photos.csv
  const missingCsvPath = path.resolve(process.cwd(), 'missing-photos.csv');
  const missingHeaders = ['roll_no', 'stud_id', 'name', 'program', 'year', 'section'];
  const missingRows = missingStudents.map(s =>
    [s.roll_no, s.stud_id, s.name, s.program, s.year, s.section].map(escapeCsv).join(',')
  );
  fs.writeFileSync(missingCsvPath, [missingHeaders.join(','), ...missingRows].join('\n'), 'utf8');

  // Print Summary Table
  console.log('\n====================================================');
  console.log('📊 UPLOAD SUMMARY');
  console.log('====================================================');
  console.table({
    'Total Files Processed': finalReports.length,
    'Matched & Ready/Uploaded': finalReports.filter(r => r.status === 'success' || r.status === 'matched (dry-run)').length,
    'Duplicates Found': summary.duplicate,
    'Unmatched (No Student)': summary.unmatched,
    'Skipped (Existing Photo)': summary.skipped,
    'Ignored / Unsupported': summary.ignored,
    'Upload Failures': failCount,
    'Students Missing Photo': missingStudents.length
  });

  console.log(`\n📄 Report written to:  ${reportCsvPath}`);
  console.log(`📄 Missing written to: ${missingCsvPath}`);

  if (failCount > 0) {
    console.error(`\n❌ Completed with ${failCount} failed uploads.`);
    process.exit(1);
  } else {
    console.log('\n✅ Completed successfully.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
