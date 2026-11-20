import type { ApiErrorBody } from '@draft-xi/server/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
      body: init.body === undefined ? null : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection.');
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? `Request failed (${res.status})`, err?.issues);
  }
  return data as T;
}

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong';
