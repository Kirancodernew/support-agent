export type FieldError = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: FieldError[] = [],
  ) {
    super(message);
  }
}

/** Calls our API through the same-origin /api proxy, so the session cookie is sent automatically. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.message ?? 'Something went wrong', data.details);
  return data as T;
}

export type Me = { user: { id: string; email: string }; workspace: { id: string; name: string; isDemo: boolean } };

export type ApiKey = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export type DocumentStatus = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed';

export type Doc = {
  id: string;
  filename: string;
  size: number;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
};

export type SearchResult = { documentId: string; filename: string; position: number; text: string; score: number };

/** Reports an API error to the user, or sends them to log in if the session is gone. */
export type ErrorHandler = (err: unknown) => void;
