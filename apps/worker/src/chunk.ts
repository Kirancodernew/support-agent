/**
 * Splits text into pieces of about `size` characters for embedding.
 * - Packs whole paragraphs together where possible, so chunks follow the document's structure.
 * - Each chunk starts with the last ~`overlap` characters of the previous one, so a sentence
 *   that falls on a boundary still appears whole in at least one chunk.
 */
export function chunkText(text: string, { size = 1000, overlap = 150 } = {}): string[] {
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let current = '';
  for (const piece of splitIntoPieces(clean, size)) {
    if (current && current.length + 2 + piece.length > size) {
      chunks.push(current);
      current = tail(current, overlap);
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Paragraphs, falling back to sentences, then words, so no piece is longer than `size`. */
function splitIntoPieces(text: string, size: number): string[] {
  return text.split('\n\n').flatMap((paragraph) => {
    if (paragraph.length <= size) return [paragraph];
    return paragraph.split(/(?<=[.!?])\s+/).flatMap((sentence) => (sentence.length <= size ? [sentence] : splitWords(sentence, size)));
  });
}

function splitWords(text: string, size: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    // A single "word" longer than size (e.g. a URL) is cut hard.
    for (let w = word; w.length > 0; w = w.slice(size)) {
      const part = w.slice(0, size);
      if (line && line.length + 1 + part.length > size) {
        out.push(line);
        line = '';
      }
      line = line ? `${line} ${part}` : part;
    }
  }
  if (line) out.push(line);
  return out;
}

/** The last ~n characters, starting at a word boundary. */
function tail(text: string, n: number): string {
  // Careful: slice(-0) is slice(0), the whole string, not an empty one.
  if (n <= 0) return '';
  if (text.length <= n) return text;
  const end = text.slice(-n);
  const space = end.indexOf(' ');
  return space === -1 ? end : end.slice(space + 1);
}
