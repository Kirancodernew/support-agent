export type ErrorDetail = { path: string; message: string };

/** An error with an HTTP status and a stable machine-readable code, turned into JSON by the error handler. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
