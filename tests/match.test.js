import { describe, it, expect } from 'vitest';
import { normalizeKey, matchFilesToStudents } from '../scripts/lib/match.mjs';

describe('scripts/lib/match.mjs', () => {
  const sampleStudents = [
    { id: 'uuid-1', roll_no: '2420101', stud_id: 'UU21001', name: 'Alice Smith', photo_path: null },
    { id: 'uuid-2', roll_no: '2420102', stud_id: 'UU21002', name: 'Bob Jones', photo_path: 'students/uuid-2.jpg' },
    { id: 'uuid-3', roll_no: null, stud_id: 'UU21003', name: 'Charlie Brown', photo_path: null },
    { id: 'uuid-4', roll_no: '2420104', stud_id: null, name: 'Diana Prince', photo_path: null }
  ];

  it('normalizes filenames correctly', () => {
    expect(normalizeKey(' 2420101.jpg ')).toBe('2420101');
    expect(normalizeKey('uu21002.png')).toBe('UU21002');
    expect(normalizeKey('2420103.WEBP')).toBe('2420103');
    expect(normalizeKey('')).toBe('');
    expect(normalizeKey(null)).toBe('');
  });

  it('matches exact roll_no match', () => {
    const { results } = matchFilesToStudents(['2420101.jpg'], sampleStudents);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('matched');
    expect(results[0].student.id).toBe('uuid-1');
    expect(results[0].matchedBy).toBe('roll_no');
  });

  it('matches lowercase file name', () => {
    const { results } = matchFilesToStudents(['2420101.png'], sampleStudents);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('matched');
    expect(results[0].student.id).toBe('uuid-1');
  });

  it('handles spaces around file names and case insensitivity', () => {
    const { results } = matchFilesToStudents(['  2420101 .jpg '], sampleStudents);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('matched');
    expect(results[0].student.id).toBe('uuid-1');
  });

  it('falls back to stud_id when roll_no is missing or does not match', () => {
    const { results } = matchFilesToStudents(['UU21003.jpg'], sampleStudents);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('matched');
    expect(results[0].student.id).toBe('uuid-3');
    expect(results[0].matchedBy).toBe('stud_id');
  });

  it('detects two files mapping to one student as duplicate', () => {
    const { results, summary } = matchFilesToStudents(['2420101.jpg', 'UU21001.png'], sampleStudents);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('matched');
    expect(results[1].status).toBe('duplicate');
    expect(summary.duplicate).toBe(1);
  });

  it('marks file as unmatched when no student exists', () => {
    const { results, summary } = matchFilesToStudents(['9999999.jpg'], sampleStudents);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('unmatched');
    expect(summary.unmatched).toBe(1);
  });

  it('skips student who already has photo unless overwrite is set', () => {
    const { results: withoutOverwrite } = matchFilesToStudents(['2420102.jpg'], sampleStudents, { overwrite: false });
    expect(withoutOverwrite[0].status).toBe('skipped');

    const { results: withOverwrite } = matchFilesToStudents(['2420102.jpg'], sampleStudents, { overwrite: true });
    expect(withOverwrite[0].status).toBe('matched');
  });

  it('correctly reports missingStudents for students who have no photo', () => {
    // Only upload photo for Alice (uuid-1)
    const { missingStudents } = matchFilesToStudents(['2420101.jpg'], sampleStudents);
    // Bob has existing photo (uuid-2), Alice got matched (uuid-1), Charlie (uuid-3) and Diana (uuid-4) remain missing
    expect(missingStudents.map(s => s.id)).toEqual(['uuid-3', 'uuid-4']);
  });

  it('handles empty folder gracefully', () => {
    const { results, summary, missingStudents } = matchFilesToStudents([], sampleStudents);
    expect(results).toHaveLength(0);
    expect(summary.total).toBe(0);
    // All students without photo (uuid-1, uuid-3, uuid-4) are missing
    expect(missingStudents).toHaveLength(3);
  });

  it('ignores unsupported formats such as .heic with warning', () => {
    const { results, summary } = matchFilesToStudents(['2420101.heic', 'notes.txt'], sampleStudents);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ignored');
    expect(results[0].message).toContain('HEIC');
    expect(summary.ignored).toBe(2);
  });
});
