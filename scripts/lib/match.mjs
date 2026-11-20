import path from 'path';

export const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const SKIPPED_EXTENSIONS = new Set(['.heic', '.heif']);

/**
 * Normalizes a filename or identifier (removes extension if present, trims, and uppercases).
 * @param {string} input 
 * @returns {string}
 */
export function normalizeKey(input) {
  if (!input || typeof input !== 'string') return '';
  const parsed = path.parse(input);
  // If parsed.name exists and has an extension in input, use parsed.name; otherwise use input
  const base = parsed.ext ? parsed.name : input;
  return base.trim().toUpperCase();
}

/**
 * Matches a list of photo files to student records.
 * 
 * @param {string[]} fileList Array of filenames or relative paths
 * @param {Array<Object>} students Array of student objects { id, roll_no, stud_id, name, photo_path, ... }
 * @param {Object} options { overwrite: boolean }
 * @returns {{
 *   results: Array<{ file: string, status: 'matched'|'unmatched'|'duplicate'|'skipped'|'ignored', student: Object|null, matchedBy: 'roll_no'|'stud_id'|null, message: string }>,
 *   missingStudents: Array<Object>,
 *   summary: { total: number, matched: number, duplicate: number, unmatched: number, skipped: number, ignored: number }
 * }}
 */
export function matchFilesToStudents(fileList = [], students = [], options = { overwrite: false }) {
  const { overwrite = false } = options;

  // Build lookups for roll_no and stud_id
  const rollMap = new Map();
  const studIdMap = new Map();

  for (const s of students) {
    if (s.roll_no) {
      const key = normalizeKey(s.roll_no);
      if (key && !rollMap.has(key)) {
        rollMap.set(key, s);
      }
    }
    if (s.stud_id) {
      const key = normalizeKey(s.stud_id);
      if (key && !studIdMap.has(key)) {
        studIdMap.set(key, s);
      }
    }
  }

  const results = [];
  const claimedStudents = new Map(); // studentId -> firstFile
  const matchedStudentIds = new Set();

  for (const rawFile of fileList) {
    const file = typeof rawFile === 'string' ? rawFile.trim() : '';
    const ext = path.extname(file).toLowerCase();
    
    // Check for skipped formats (like HEIC)
    if (SKIPPED_EXTENSIONS.has(ext)) {
      results.push({
        file: rawFile,
        status: 'ignored',
        student: null,
        matchedBy: null,
        message: `Skipped unsupported format (${ext.toUpperCase()}). Convert to JPG/PNG/WebP before upload.`
      });
      continue;
    }

    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      results.push({
        file: rawFile,
        status: 'ignored',
        student: null,
        matchedBy: null,
        message: `Ignored non-image or unsupported file type (${ext ? ext.toUpperCase() : 'no extension'}).`
      });
      continue;
    }

    const key = normalizeKey(file);
    if (!key) {
      results.push({
        file,
        status: 'unmatched',
        student: null,
        matchedBy: null,
        message: 'Empty filename after normalization'
      });
      continue;
    }

    // Try roll_no first, then stud_id
    let student = rollMap.get(key);
    let matchedBy = null;

    if (student) {
      matchedBy = 'roll_no';
    } else if (studIdMap.has(key)) {
      student = studIdMap.get(key);
      matchedBy = 'stud_id';
    }

    if (!student) {
      results.push({
        file,
        status: 'unmatched',
        student: null,
        matchedBy: null,
        message: `No student matches identifier '${key}' (checked roll_no and stud_id)`
      });
      continue;
    }

    // Check for duplicate file pointing to the same student
    if (claimedStudents.has(student.id)) {
      const firstFile = claimedStudents.get(student.id);
      results.push({
        file,
        status: 'duplicate',
        student,
        matchedBy,
        message: `Duplicate image for student ${student.name} (${student.roll_no || student.stud_id}). Already mapped by '${firstFile}'`
      });
      continue;
    }

    // Mark as claimed
    claimedStudents.set(student.id, file);

    // Check if student already has a photo and overwrite is false
    if (student.photo_path && !overwrite) {
      results.push({
        file,
        status: 'skipped',
        student,
        matchedBy,
        message: `Student already has a photo (${student.photo_path}). Use --overwrite to replace.`
      });
      continue;
    }

    matchedStudentIds.add(student.id);
    results.push({
      file,
      status: 'matched',
      student,
      matchedBy,
      message: `Matched to ${student.name} via ${matchedBy}`
    });
  }

  // Find students who still don't have a photo after this matching
  const missingStudents = students.filter(s => {
    // If student was matched in this run, they will have a photo
    if (matchedStudentIds.has(s.id)) return false;
    // If student already has a photo, they are not missing
    if (s.photo_path) return false;
    return true;
  });

  const summary = {
    total: results.length,
    matched: results.filter(r => r.status === 'matched').length,
    duplicate: results.filter(r => r.status === 'duplicate').length,
    unmatched: results.filter(r => r.status === 'unmatched').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    ignored: results.filter(r => r.status === 'ignored').length
  };

  return { results, missingStudents, summary };
}
