// Cache storage for signed photo URLs
// Key format: path + '|' + version
export const _photoUrlCache = new Map(); // key -> { url: string, expiresAt: number }
export const _inFlightPromises = new Map(); // key -> Promise<string | null>

export const STORAGE_BUCKET = 'student-photos';
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_INPUT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit
export const MAX_OUTPUT_SIZE_BYTES = 150 * 1024; // 150 KB limit
export const SIGNED_URL_EXPIRY_SECONDS = 3600;
export const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer

/**
 * Resets the in-memory signed URL cache (useful for testing or cache invalidation).
 */
export function clearPhotoUrlCache() {
  _photoUrlCache.clear();
  _inFlightPromises.clear();
}

/**
 * Validates and compresses an image file into a square JPEG blob.
 * 
 * @param {File|Blob} file 
 * @param {Object} [options]
 * @param {number} [options.size=400] Target width and height in pixels
 * @param {number} [options.quality=0.82] Initial JPEG quality (0.0 to 1.0)
 * @returns {Promise<Blob>}
 */
export async function compressImage(file, { size = 400, quality = 0.82 } = {}) {
  if (!file) {
    throw new Error('No image file provided.');
  }

  // 1. Validate file type
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(`Unsupported file format '${file.type || 'unknown'}'. Please upload a JPEG, PNG, or WebP image.`);
  }

  // 2. Validate input file size (max 10 MB)
  if (file.size > MAX_INPUT_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`Image is too large (${sizeMb} MB). Maximum allowed size is 10 MB.`);
  }

  // 3. Decode image with EXIF orientation correction
  let imgBitmap;
  try {
    if (typeof createImageBitmap === 'function') {
      try {
        imgBitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        // Fallback if imageOrientation option is not supported in the browser
        imgBitmap = await createImageBitmap(file);
      }
    }
  } catch (err) {
    // Will fallback to HTMLImageElement below if createImageBitmap fails
  }

  let srcWidth, srcHeight, sourceDrawable;

  if (imgBitmap) {
    srcWidth = imgBitmap.width;
    srcHeight = imgBitmap.height;
    sourceDrawable = imgBitmap;
  } else if (typeof document !== 'undefined') {
    // Fallback for environments where createImageBitmap is unavailable
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load image into browser DOM.'));
        image.src = objectUrl;
      });
      srcWidth = img.naturalWidth || img.width;
      srcHeight = img.naturalHeight || img.height;
      sourceDrawable = img;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } else {
    throw new Error('Image decoding is not supported in this runtime environment.');
  }

  // 4. Center-crop to a square and draw on size x size canvas
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    if (imgBitmap?.close) imgBitmap.close();
    throw new Error('HTML Canvas is not available.');
  }

  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (imgBitmap?.close) imgBitmap.close();
    throw new Error('Could not get 2D canvas context.');
  }

  const minDim = Math.min(srcWidth, srcHeight);
  const sx = (srcWidth - minDim) / 2;
  const sy = (srcHeight - minDim) / 2;

  // Use crisp image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceDrawable, sx, sy, minDim, minDim, 0, 0, size, size);

  if (imgBitmap?.close) {
    imgBitmap.close();
  }

  // Helper to convert canvas to JPEG Blob
  const toBlob = (q) =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        b => {
          if (b) resolve(b);
          else reject(new Error('Canvas compression export failed.'));
        },
        'image/jpeg',
        q
      );
    });

  // 5. Compress and check 150 KB limit with progressive retries
  const qualitySteps = [quality, 0.70, 0.60];
  let finalBlob = null;

  for (const q of qualitySteps) {
    const blob = await toBlob(q);
    if (blob.size <= MAX_OUTPUT_SIZE_BYTES) {
      finalBlob = blob;
      break;
    }
    finalBlob = blob; // keep as fallback if last
  }

  if (finalBlob && finalBlob.size > MAX_OUTPUT_SIZE_BYTES) {
    const finalKb = Math.round(finalBlob.size / 1024);
    throw new Error(`Compressed image size (${finalKb} KB) exceeds the 150 KB limit even at lowest quality. Please select a clearer or smaller photo.`);
  }

  return finalBlob;
}

/**
 * Uploads a student photo to Supabase storage and links it to the student record.
 * 
 * @param {Object} supabase Supabase client instance
 * @param {Object} student Student record { id, ... }
 * @param {File|Blob} file Image file
 * @returns {Promise<{ photo_path: string, photo_updated_at: string }>}
 */
export async function uploadStudentPhoto(supabase, student, file) {
  if (!supabase) throw new Error('Supabase client is required.');
  if (!student?.id) throw new Error('Student record with valid UUID is required.');
  if (!file) throw new Error('No photo file selected.');

  // 1. Client-side compression
  const compressedBlob = await compressImage(file, { size: 400, quality: 0.82 });

  // 2. Upload to storage bucket: students/<student.id>.jpg
  const photo_path = `students/${student.id}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(photo_path, compressedBlob, {
      upsert: true,
      contentType: 'image/jpeg',
      cacheControl: '3600'
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // 3. Update student database record
  const photo_updated_at = new Date().toISOString();
  const { error: dbError } = await supabase
    .from('students')
    .update({ photo_path, photo_updated_at })
    .eq('id', student.id);

  if (dbError) {
    throw new Error(`Database update failed after photo upload: ${dbError.message}`);
  }

  // 4. Invalidate any stale cache for this path
  clearPathFromCache(photo_path);

  return { photo_path, photo_updated_at };
}

/**
 * Removes a student photo from storage and clears the database reference.
 * 
 * @param {Object} supabase 
 * @param {Object} student 
 * @returns {Promise<{ photo_path: null, photo_updated_at: string }>}
 */
export async function deleteStudentPhoto(supabase, student) {
  if (!supabase) throw new Error('Supabase client is required.');
  if (!student?.id) throw new Error('Student record is required.');

  if (student.photo_path) {
    // Remove object from storage
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([student.photo_path]);
    
    if (storageError) {
      console.warn(`Storage delete warning: ${storageError.message}`);
    }

    clearPathFromCache(student.photo_path);
  }

  // Clear reference in DB
  const photo_updated_at = new Date().toISOString();
  const { error: dbError } = await supabase
    .from('students')
    .update({ photo_path: null, photo_updated_at })
    .eq('id', student.id);

  if (dbError) {
    throw new Error(`Failed to update student record: ${dbError.message}`);
  }

  return { photo_path: null, photo_updated_at };
}

/**
 * Removes any cached entries for a specific photo path.
 * @param {string} path 
 */
export function clearPathFromCache(path) {
  if (!path) return;
  for (const key of _photoUrlCache.keys()) {
    if (key.startsWith(path + '|')) {
      _photoUrlCache.delete(key);
    }
  }
}

/**
 * Generates or retrieves a short-lived signed URL for a photo path with in-memory caching and deduplication.
 * 
 * @param {Object} supabase Supabase client
 * @param {string} path Storage object path (e.g. 'students/uuid.jpg')
 * @param {string|number} [version] Version identifier (typically photo_updated_at)
 * @param {Object} [options]
 * @param {boolean} [options.bypassCache=false] Force fetching a fresh signed URL
 * @returns {Promise<string|null>} Signed URL or null on error
 */
export async function getSignedPhotoUrl(supabase, path, version = '1', { bypassCache = false } = {}) {
  if (!supabase || !path) return null;

  const key = `${path}|${version || ''}`;
  const now = Date.now();

  // 1. Check in-memory cache if not bypassing
  if (!bypassCache && _photoUrlCache.has(key)) {
    const cached = _photoUrlCache.get(key);
    // Reuse cached URL until 5 minutes (300,000 ms) before expiry
    if (cached && cached.expiresAt - now > EXPIRY_BUFFER_MS) {
      return cached.url;
    }
    // Expired or close to expiry; remove it
    _photoUrlCache.delete(key);
  }

  // 2. Check for in-flight request to deduplicate concurrent calls
  if (_inFlightPromises.has(key)) {
    return _inFlightPromises.get(key);
  }

  // 3. Initiate new signed URL request
  const fetchPromise = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);

      if (error || !data?.signedUrl) {
        return null;
      }

      // Store in cache
      const expiresAt = Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000;
      _photoUrlCache.set(key, { url: data.signedUrl, expiresAt });
      return data.signedUrl;
    } catch {
      return null;
    } finally {
      _inFlightPromises.delete(key);
    }
  })();

  _inFlightPromises.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Counts how many students in the given array are missing a registered photo.
 * @param {Array<Object>} students 
 * @returns {number}
 */
export function countStudentsWithoutPhoto(students = []) {
  if (!Array.isArray(students)) return 0;
  return students.filter(s => !s?.photo_path).length;
}

/**
 * Filters a list of students by photo availability.
 * @param {Array<Object>} students 
 * @param {'all'|'with_photo'|'missing'} filter 
 * @returns {Array<Object>}
 */
export function filterStudentsByPhoto(students = [], filter = 'all') {
  if (!Array.isArray(students)) return [];
  if (filter === 'with_photo') {
    return students.filter(s => Boolean(s?.photo_path));
  }
  if (filter === 'missing') {
    return students.filter(s => !s?.photo_path);
  }
  return students;
}
