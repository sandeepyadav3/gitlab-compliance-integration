export class ApiError extends Error {
  status: number; requestId: string | undefined; activeRunId: string | undefined;
  constructor(status: number, message: string, requestId?: string, activeRunId?: string) {
    super(message); this.status = status; this.requestId = requestId; this.activeRunId = activeRunId;
  }
}
export async function api<T>(path: string, signal?: AbortSignal, body?: unknown, method = 'POST'): Promise<T> {
  try {
    const timeout = AbortSignal.timeout(12_000);
    const response = await fetch(path, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new ApiError(response.status, value.error?.message ?? 'Request could not be completed.', value.error?.requestId, value.error?.activeRunId);
    return value as T;
  } catch (error) {
    if (error instanceof ApiError || signal?.aborted) throw error;
    throw new ApiError(0, 'Cannot reach the local server. Check that npm start is running, then retry.');
  }
}
export function parseIds(text: string): number[] {
  const values = text.split(/[\s,]+/).filter(Boolean);
  if (!values.length || values.length > 25 || values.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    throw new Error('Enter 1-25 numeric GitLab project IDs, separated by commas or new lines.');
  }
  return [...new Set(values.map(Number))];
}
