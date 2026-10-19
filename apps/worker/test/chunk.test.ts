import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/chunk';

const sentence = (i: number) => `Sentence number ${i} explains one small fact about the product.`;

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(' \n\n \t ')).toEqual([]);
  });

  it('keeps short text as a single chunk, tidied up', () => {
    expect(chunkText('  Hello   world.\r\n\r\n\r\n\r\nSecond   paragraph. ')).toEqual(['Hello world.\n\nSecond paragraph.']);
  });

  it('splits long text into bounded chunks that overlap', () => {
    const text = Array.from({ length: 80 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkText(text, { size: 500, overlap: 100 });

    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500 + 100 + 2);
    // Each chunk begins with text from the end of the previous one.
    for (let i = 1; i < chunks.length; i++) {
      const start = chunks[i]!.slice(0, 30);
      expect(chunks[i - 1]).toContain(start.split('\n\n')[0]!);
    }
  });

  it('never loses a sentence: each one appears whole in some chunk', () => {
    const text = Array.from({ length: 80 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkText(text, { size: 500, overlap: 100 });
    for (let i = 0; i < 80; i++) expect(chunks.some((c) => c.includes(sentence(i)))).toBe(true);
  });

  it('cuts a single giant word instead of producing an oversized chunk', () => {
    const chunks = chunkText('x'.repeat(2500), { size: 1000, overlap: 0 });
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks.join('').replace(/\s/g, '')).toHaveLength(2500);
  });
});
