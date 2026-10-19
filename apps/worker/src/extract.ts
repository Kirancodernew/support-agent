import { UnrecoverableError } from 'bullmq';
import { extractText as extractPdfText } from 'unpdf';

/** Plain text from an uploaded file. Unreadable files fail permanently: retrying won't help. */
export async function extractText(bytes: Uint8Array, contentType: string): Promise<string> {
  if (contentType !== 'application/pdf') return new TextDecoder('utf-8').decode(bytes);
  try {
    const { text } = await extractPdfText(bytes, { mergePages: true });
    return text;
  } catch {
    throw new UnrecoverableError('Could not read this PDF. It may be damaged or password-protected.');
  }
}
