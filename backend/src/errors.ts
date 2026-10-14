export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Every error response has this shape; the app reads `error.code`. */
export const fail = (code: string, message: string) => ({ success: false, error: { code, message } });
