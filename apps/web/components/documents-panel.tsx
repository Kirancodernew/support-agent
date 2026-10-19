'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, ApiError, type Doc, type DocumentStatus, type ErrorHandler } from '@/lib/api';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.txt,.md,.markdown';
const IN_PROGRESS: DocumentStatus[] = ['uploading', 'queued', 'processing'];

const STATUS_LABEL: Record<DocumentStatus, string> = {
  uploading: 'Uploading…',
  queued: 'Queued',
  processing: 'Processing…',
  ready: 'Ready',
  failed: 'Failed',
};

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function DocumentsPanel({ onError }: { onError: ErrorHandler }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api<{ documents: Doc[] }>('/documents')
        .then((res) => setDocs(res.documents))
        .catch(onError),
    [onError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // While anything is still being processed, refresh every 2s so the status updates live.
  const busy = docs.some((d) => IN_PROGRESS.includes(d.status));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [busy, load]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_BYTES) return setMessage('Files can be up to 10 MB.');

    setUploading(true);
    try {
      // 1. Ask our API for a one-time upload form.
      const { document, upload } = await api<{ document: Doc; upload: { url: string; fields: Record<string, string> } }>(
        '/documents',
        { method: 'POST', body: JSON.stringify({ filename: file.name, size: file.size }) },
      );
      setDocs((d) => [document, ...d]);

      // 2. Send the file straight to S3. The signed fields must come before the file.
      const form = new FormData();
      for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
      form.append('file', file);
      const s3 = await fetch(upload.url, { method: 'POST', body: form });
      if (!s3.ok) throw new ApiError(s3.status, 'Upload to storage failed. Please try again.');

      // 3. Tell our API it's there, which queues processing.
      await api(`/documents/${document.id}/complete`, { method: 'POST' });
      await load();
    } catch (err) {
      onError(err);
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function remove(doc: Doc) {
    if (!confirm(`Delete "${doc.filename}"? The agent will no longer use it.`)) return;
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE' });
      setDocs((d) => d.filter((x) => x.id !== doc.id));
    } catch (err) {
      onError(err);
    }
  }

  return (
    <section className="card">
      <h2>Documents</h2>
      <p>Upload your help docs. The agent answers from them. PDF, TXT or Markdown, up to 10 MB.</p>

      <div className="inline-form">
        <input ref={fileInput} type="file" accept={ACCEPT} onChange={onFile} disabled={uploading} hidden />
        <button onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload document'}
        </button>
      </div>
      {message && <p className="error">{message}</p>}

      {docs.length === 0 ? (
        <p className="muted">No documents yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="filename">{d.filename}</td>
                <td>
                  <span className={`status status-${d.status}`}>{STATUS_LABEL[d.status]}</span>
                  {d.status === 'ready' && <small className="muted"> · {d.chunkCount} passages</small>}
                  {d.error && <small className="error block">{d.error}</small>}
                </td>
                <td>{formatSize(d.size)}</td>
                <td>
                  <button className="danger" onClick={() => remove(d)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
