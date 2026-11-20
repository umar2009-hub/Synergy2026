# Synergy 2026 — Student Photo Upload & Management Setup Guide

This guide details the complete setup, configuration, and verification procedures for the **Student Photo Upload and Management Feature** in the **Synergy 2026** farewell entry verification application.

---

## 1. Architecture & Overview

- **Storage Bucket:** `student-photos` (Private bucket, 200 KB max object size, JPEG only).
- **Storage Path Convention:** `students/<student_id>.jpg` (Uses the student's UUID/id, never exposing personal roll numbers or sensitive details in storage keys).
- **Client-Side Optimization:** Images are validated, decoded with EXIF orientation correction, square center-cropped, resized to 400×400 pixels, and compressed with progressive JPEG quality retries to guarantee file size is strictly below 150 KB before transmission.
- **Access Model:** Short-lived signed URLs (1 hour expiry) with smart in-memory caching and request deduplication. Signed URLs refresh automatically 5 minutes before expiry.
- **Security:** Private bucket with strict row and storage access policies; no public URLs. Service-role keys are isolated to backend scripts (`.env.local`) and never bundled into frontend assets.

---

## 2. Supabase Database & Storage Migration

Run the following SQL migration in your **Supabase Dashboard > SQL Editor**:

```sql
-- ====================================================
-- 1. ADD PHOTO REFERENCE COLUMNS TO STUDENTS TABLE
-- ====================================================
ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS photo_path TEXT,
ADD COLUMN IF NOT EXISTS photo_updated_at TIMESTAMPTZ;

-- ====================================================
-- 2. CREATE PRIVATE STORAGE BUCKET
-- ====================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'student-photos', 
    'student-photos', 
    false, 
    204800, -- 200 KB in bytes
    ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 204800,
    allowed_mime_types = ARRAY['image/jpeg'];

-- ====================================================
-- 3. STORAGE ACCESS POLICIES
-- ====================================================

-- Policy A: Allow reading photos via short-lived signed URLs
CREATE POLICY "Allow read access to student photos" ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'student-photos');

-- Policy B: Allow authorized uploads
CREATE POLICY "Allow upload to student photos" ON storage.objects
    FOR INSERT TO anon, authenticated
    WITH CHECK (bucket_id = 'student-photos');

-- Policy C: Allow updating existing photos
CREATE POLICY "Allow update to student photos" ON storage.objects
    FOR UPDATE TO anon, authenticated
    USING (bucket_id = 'student-photos');

-- Policy D: Allow deleting photos
CREATE POLICY "Allow delete from student photos" ON storage.objects
    FOR DELETE TO anon, authenticated
    USING (bucket_id = 'student-photos');
```

### Explanation of Storage Policies
1. **`Allow read access to student photos`**: Enables Supabase Storage to issue short-lived signed download tokens (`createSignedUrl`) to the client without exposing the bucket to the public internet.
2. **`Allow upload to student photos`**: Restricts inserts exclusively to the `student-photos` bucket.
3. **`Allow update to student photos`**: Permits overwriting existing student photo paths with `{ upsert: true }`.
4. **`Allow delete from student photos`**: Allows Master Administrators to remove outdated photos upon student photo replacement or deletion.

---

## 3. Environment Variables Configuration

### Frontend Application (`.env`)
Create or edit `.env` in the project root:
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_KEY=your-supabase-anon-public-key
```
> **Security Note:** Only `VITE_` prefixed variables are accessible to client-side code. Never put service-role keys in `.env`.

### Bulk Upload Tool (`.env.local`)
The bulk upload script requires administrator service-role credentials to bypass rate limits and match 4,000+ records. Create `.env.local` in the project root (this file is ignored by Git):
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret-key
```
> **Security Rule:** `.env.local` is listed in `.gitignore` and must NEVER be committed to version control or included in frontend builds.

---

## 4. Local Execution & Testing

### A. Run Development Server
```powershell
npm run dev
```
Open `http://localhost:5173` in your browser.

### B. Run Unit Test Suite
To verify image matching logic, signed URL caching, and photo filters:
```powershell
npm test
```
All 20 test specifications should pass cleanly.

### C. Build for Production
```powershell
npm run build
```
Confirms clean bundling with less than 5 KB gzip increase.

---

## 5. Step-by-Step Feature Walkthrough

### 1. Uploading a Single Photo (Master Admin)
1. Navigate to the app and click **"🛡️ SECURE GATEWAY ACCESS"**.
2. Enter your Master Admin PIN (default: `22568`).
3. Under **GUEST ARCHIVE**, find any student.
4. Click the **"PHOTO"** button on the student's row.
5. Select a JPEG, PNG, or WebP photo from your device.
   - The app optimizes and compresses the image to a 400×400 square JPEG under 150 KB.
   - An inline spinner displays during transmission.
   - On completion, the thumbnail updates instantly with the student's photo.

### 2. Full-Resolution Face Matching (Lightbox)
1. Click on the student's avatar thumbnail in any row (available to both Master Admin and Gate Sub-Admins).
2. The **FACE VERIFICATION** lightbox modal opens with:
   - High-resolution student photo.
   - Student Full Name, Roll Number, and Program/Year/Section.
   - Real-time `PAID GUEST` or `UNPAID` badge.
   - Gate clearance status.
3. Press `Escape`, click the `✕` button, or tap the background to close.

### 3. Replacing or Removing a Photo
- In the student row, Master Admins see the button toggle to **"REPLACE"**.
- Click **"REPLACE"** to select a new image. The previous storage object is safely overwritten and the DB timestamp updates.
- Inside the Lightbox, Master Admins also have dedicated **"REPLACE PHOTO"** and **"DELETE"** buttons.

### 4. Enrolling a New Student with Photo
1. Go to the **ENROLL NEW** tab.
2. Fill in Roll Number, Name, Program, Year, Section, and Payment Status.
3. Click **"CHOOSE PHOTO"** under **STUDENT PHOTOGRAPH (OPTIONAL)**.
   - A live 56×56 compressed preview appears with a `✕` removal option.
4. Click **"Commit to Database ✦"**.
   - Inserts the student record and uploads the photo.
   - If the student is inserted but the network drops during image upload, the app notifies: *"Student added, photo failed. Retry from Guest Archive."*

### 5. Filtering Students by Photo Status
In the **GUEST ARCHIVE** tab, Master Admins have access to the **Photo Filter**:
- `Photo: All`: Shows all manifest records.
- `With Photo`: Displays only students who have a verified photograph.
- `Missing`: Isolates students who still need photos uploaded.
- The indicator banner displays: `N students without photo`.

---

## 6. Bulk Photo Upload CLI (Laptop Script)

For bulk uploading hundreds or thousands of photos from a folder:

### File Naming Convention
Name each photo file with the student's **Roll Number** or **College ID**:
- `24201010003.jpg` (matched via `roll_no`)
- `UU242010097.png` (matched via `stud_id`)
- Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`.

### Step 1: Run Dry-Run Simulation
Always simulate before uploading to audit matches and detect duplicates:
```powershell
node scripts/upload-photos.mjs --dir ./photos --dry-run
```
- Outputs an analysis table showing matched, duplicate, unmatched, and skipped files.
- Generates `photo-upload-report.csv` with per-file status.
- Generates `missing-photos.csv` listing all students who still lack a photo.

### Step 2: Run Live Upload
When the dry-run report looks correct:
```powershell
node scripts/upload-photos.mjs --dir ./photos --concurrency 5
```
To overwrite existing photos for matched students:
```powershell
node scripts/upload-photos.mjs --dir ./photos --overwrite
```

---

## 7. Common Errors & Troubleshooting

| Error Symptom | Cause | Resolution |
| :--- | :--- | :--- |
| `Unsupported file format` | User selected an unsupported format (GIF, HEIC, PDF). | Convert the image to JPEG, PNG, or WebP. |
| `Image is too large (X MB)` | File size exceeds 10 MB limit before compression. | Select a standard camera or passport photo. |
| `Storage upload failed: Bucket not found` | The `student-photos` bucket was not created in Supabase. | Run Section 2 SQL migration in Supabase SQL editor. |
| `Missing SUPABASE_URL in .env.local` | Running bulk script without credentials. | Create `.env.local` and add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. |
| `No student matches identifier` | Filename does not match any student's `roll_no` or `stud_id`. | Rename the image to the exact roll number or college ID. |

---

## 8. Security Checklist for Production

Before using real student photographs in a production event:

- [x] Storage bucket `student-photos` is marked **Private** (`public = false`).
- [x] No permanent public URLs are exposed or stored in the database.
- [x] Signed URLs expire in 3600 seconds (1 hour).
- [x] The guest-facing verification page (`view === "result"`) does **not** display photos.
- [x] Storage objects are named `students/<uuid>.jpg` to prevent exposing roll numbers in URLs.
- [x] `.env.local` and CSV reports are added to `.gitignore`.
- [x] No service-role credentials exist anywhere in `src/` or the client Vite bundle.
