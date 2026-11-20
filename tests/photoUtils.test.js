import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSignedPhotoUrl,
  clearPhotoUrlCache,
  _photoUrlCache,
  countStudentsWithoutPhoto,
  filterStudentsByPhoto,
  EXPIRY_BUFFER_MS
} from '../src/photoUtils.js';

describe('src/photoUtils.js', () => {
  beforeEach(() => {
    clearPhotoUrlCache();
    vi.restoreAllMocks();
  });

  describe('getSignedPhotoUrl', () => {
    it('returns null if path or supabase client is missing', async () => {
      expect(await getSignedPhotoUrl(null, 'path.jpg')).toBeNull();
      expect(await getSignedPhotoUrl({}, null)).toBeNull();
    });

    it('creates and returns a signed URL on cache miss', async () => {
      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            createSignedUrl: vi.fn().mockResolvedValue({
              data: { signedUrl: 'https://example.com/signed/photo1.jpg?token=abc' },
              error: null
            })
          })
        }
      };

      const url = await getSignedPhotoUrl(mockSupabase, 'students/uuid-1.jpg', 'v1');
      expect(url).toBe('https://example.com/signed/photo1.jpg?token=abc');
      expect(mockSupabase.storage.from).toHaveBeenCalledWith('student-photos');
    });

    it('returns cached URL on second call (cache hit, no new network call)', async () => {
      const createSignedUrlMock = vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://example.com/signed/photo1.jpg?token=abc' },
        error: null
      });
      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            createSignedUrl: createSignedUrlMock
          })
        }
      };

      // Call 1
      const url1 = await getSignedPhotoUrl(mockSupabase, 'students/uuid-1.jpg', 'v1');
      // Call 2
      const url2 = await getSignedPhotoUrl(mockSupabase, 'students/uuid-1.jpg', 'v1');

      expect(url1).toBe(url2);
      expect(createSignedUrlMock).toHaveBeenCalledTimes(1);
    });

    it('fetches fresh URL when version changes (cache miss after version update)', async () => {
      const createSignedUrlMock = vi.fn()
        .mockResolvedValueOnce({
          data: { signedUrl: 'https://example.com/v1.jpg' },
          error: null
        })
        .mockResolvedValueOnce({
          data: { signedUrl: 'https://example.com/v2.jpg' },
          error: null
        });

      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            createSignedUrl: createSignedUrlMock
          })
        }
      };

      const url1 = await getSignedPhotoUrl(mockSupabase, 'students/uuid-1.jpg', '2026-01-01T00:00:00Z');
      const url2 = await getSignedPhotoUrl(mockSupabase, 'students/uuid-1.jpg', '2026-01-02T00:00:00Z');

      expect(url1).toBe('https://example.com/v1.jpg');
      expect(url2).toBe('https://example.com/v2.jpg');
      expect(createSignedUrlMock).toHaveBeenCalledTimes(2);
    });

    it('refreshes URL when within 5 minutes of expiry', async () => {
      const createSignedUrlMock = vi.fn()
        .mockResolvedValueOnce({
          data: { signedUrl: 'https://example.com/old.jpg' },
          error: null
        })
        .mockResolvedValueOnce({
          data: { signedUrl: 'https://example.com/refreshed.jpg' },
          error: null
        });

      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            createSignedUrl: createSignedUrlMock
          })
        }
      };

      // Call 1: establishes cache
      await getSignedPhotoUrl(mockSupabase, 'students/uuid-1.jpg', 'v1');
      expect(createSignedUrlMock).toHaveBeenCalledTimes(1);

      // Manually wind clock forward so remaining time is less than 5 minutes (EXPIRY_BUFFER_MS)
      const key = 'students/uuid-1.jpg|v1';
      const cached = _photoUrlCache.get(key);
      cached.expiresAt = Date.now() + (EXPIRY_BUFFER_MS - 1000); // Only 4m 59s left

      // Call 2: should trigger refresh
      const refreshedUrl = await getSignedPhotoUrl(mockSupabase, 'students/uuid-1.jpg', 'v1');
      expect(refreshedUrl).toBe('https://example.com/refreshed.jpg');
      expect(createSignedUrlMock).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent calls into a single network request', async () => {
      let resolveCall;
      const deferredPromise = new Promise((resolve) => {
        resolveCall = resolve;
      });

      const createSignedUrlMock = vi.fn().mockImplementation(() => deferredPromise);
      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            createSignedUrl: createSignedUrlMock
          })
        }
      };

      // Launch 3 simultaneous concurrent calls for the exact same key
      const p1 = getSignedPhotoUrl(mockSupabase, 'students/uuid-conc.jpg', 'v1');
      const p2 = getSignedPhotoUrl(mockSupabase, 'students/uuid-conc.jpg', 'v1');
      const p3 = getSignedPhotoUrl(mockSupabase, 'students/uuid-conc.jpg', 'v1');

      // Resolve the single network call
      resolveCall({ data: { signedUrl: 'https://example.com/single-flight.jpg' }, error: null });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1).toBe('https://example.com/single-flight.jpg');
      expect(r2).toBe('https://example.com/single-flight.jpg');
      expect(r3).toBe('https://example.com/single-flight.jpg');
      expect(createSignedUrlMock).toHaveBeenCalledTimes(1);
    });

    it('returns null and does not throw when Supabase returns an error', async () => {
      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            createSignedUrl: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Object not found' }
            })
          })
        }
      };

      const result = await getSignedPhotoUrl(mockSupabase, 'students/missing.jpg', 'v1');
      expect(result).toBeNull();
    });
  });

  describe('Pure Filter & Counter Helpers', () => {
    const students = [
      { id: '1', name: 'A', photo_path: 'students/1.jpg' },
      { id: '2', name: 'B', photo_path: null },
      { id: '3', name: 'C', photo_path: 'students/3.jpg' },
      { id: '4', name: 'D', photo_path: '' }
    ];

    it('counts students without a registered photo accurately', () => {
      expect(countStudentsWithoutPhoto(students)).toBe(2);
      expect(countStudentsWithoutPhoto([])).toBe(0);
      expect(countStudentsWithoutPhoto(null)).toBe(0);
    });

    it('filters students by photo availability', () => {
      expect(filterStudentsByPhoto(students, 'all')).toHaveLength(4);
      expect(filterStudentsByPhoto(students, 'with_photo').map(s => s.id)).toEqual(['1', '3']);
      expect(filterStudentsByPhoto(students, 'missing').map(s => s.id)).toEqual(['2', '4']);
    });
  });
});
