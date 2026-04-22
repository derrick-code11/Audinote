export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  data: T | null;
  error: ApiErrorPayload | null;
  message: string | null;
}
