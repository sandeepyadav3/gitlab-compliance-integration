import { setTimeout as timerSleep } from 'node:timers/promises';
import type { ZodType } from 'zod';
import type { CollectionError, Source } from './types.ts';

export interface HttpResult<T> { value: T | null; source: Source; nextPage: string | null; }
interface Options {
  token: string;
  transport?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  signal?: AbortSignal;
}
const messages: Record<string, CollectionError> = {
  unauthorized: { code: 'unauthorized', message: 'GitLab rejected the token.', action: 'Check token validity, expiry, and read_api scope.' },
  forbidden: { code: 'forbidden', message: 'GitLab denied access to this resource.', action: 'Check account permissions and token scope, then collect again.' },
  not_found_or_inaccessible: { code: 'not_found_or_inaccessible', message: 'GitLab could not return this resource. It may be absent or inaccessible.', action: 'Verify the project ID, branch, and account access. This response does not prove absence.' },
  rate_limited: { code: 'rate_limited', message: 'GitLab rate-limited collection.', action: 'Wait before collecting again; inspect the retry status.' },
  provider_error: { code: 'provider_error', message: 'GitLab returned an unsuccessful response.', action: 'Collect again after checking GitLab availability.' },
  timeout: { code: 'timeout', message: 'The GitLab request timed out.', action: 'Check connectivity and collect again.' },
  network_error: { code: 'network_error', message: 'The GitLab request could not be completed.', action: 'Check connectivity and collect again.' },
  invalid_response: { code: 'invalid_response', message: 'GitLab returned incomplete or unexpected data.', action: 'Collect again. If this persists, check API coverage and response compatibility.' },
};

export class GitLabClient {
  #token: string;
  #transport: typeof fetch;
  #timeoutMs: number;
  #maxAttempts: number;
  #sleep: (ms: number) => Promise<void>;
  #now: () => Date;
  #signal: AbortSignal | undefined;
  constructor(options: Options) {
    if (!options.token.trim() || /[\r\n]/.test(options.token)) throw new Error('Set a valid server-side GITLAB_TOKEN.');
    this.#token = options.token;
    this.#signal = options.signal;
    this.#transport = options.transport ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#sleep = options.sleep ?? ((ms) => timerSleep(ms, undefined, options.signal ? { signal: options.signal } : {}));
    this.#now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts < 1 || this.#maxAttempts > 5 || this.#timeoutMs < 1) {
      throw new Error('Invalid GitLab request limits.');
    }
  }
  async get<T>(path: string, schema: ZodType<T>): Promise<HttpResult<T>> {
    // Only relative paths under the fixed GitLab.com API origin are accepted.
    if (!/^\/projects\/\d+(?:\/|\?|$)/.test(path) || /[\r\n#]/.test(path)) throw new Error('Invalid GitLab resource path.');
    const url = new URL('https://gitlab.com/api/v4' + path).toString();
    let source: Source = { url, observedAt: this.#now().toISOString(), httpStatus: null, attempts: 0, error: null };
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      this.#signal?.throwIfAborted();
      source = { url, observedAt: this.#now().toISOString(), httpStatus: null, attempts: attempt, error: null };
      let retryable = false;
      let retryAfterMs: number | null = null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.#transport(url, {
          method: 'GET', redirect: 'error', signal: this.#signal ? AbortSignal.any([this.#signal, controller.signal]) : controller.signal,
          headers: { 'PRIVATE-TOKEN': this.#token, Accept: 'application/json' },
        });
        source.httpStatus = response.status;
        if (response.ok) {
          // Response parsing remains under the same timeout as the HTTP request.
          const parsed = schema.safeParse(await response.json());
          if (!parsed.success) {
            source.error = messages.invalid_response!;
            return { value: null, source, nextPage: null };
          }
          return { value: parsed.data, source, nextPage: response.headers.get('x-next-page') };
        }
        const code = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden'
          : response.status === 404 ? 'not_found_or_inaccessible' : response.status === 429 ? 'rate_limited' : 'provider_error';
        source.error = messages[code]!;
        retryable = response.status === 429 || [500, 502, 503, 504].includes(response.status);
        const header = response.headers.get('retry-after');
        if (header !== null) {
          const seconds = Number(header);
          retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
            : Math.max(0, Date.parse(header) - this.#now().getTime());
          if (!Number.isFinite(retryAfterMs)) retryAfterMs = null;
        }
        await response.body?.cancel();
      } catch (error) {
        this.#signal?.throwIfAborted();
        const timedOut = controller.signal.aborted;
        const code = timedOut ? 'timeout' : error instanceof SyntaxError ? 'invalid_response' : 'network_error';
        source.error = messages[code]!;
        retryable = code !== 'invalid_response';
      } finally { clearTimeout(timer); }
      if (!retryable || attempt === this.#maxAttempts) break;
      // Do not shorten a long Retry-After and retry too early. Return a visible failure instead.
      if (retryAfterMs !== null && retryAfterMs > 5000) break;
      const delay = retryAfterMs ?? (250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
      await abortableSleep(this.#sleep, delay, this.#signal);
    }
    return { value: null, source, nextPage: null };
  }
}

async function abortableSleep(sleep: (ms: number) => Promise<void>, ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!signal) return sleep(ms);
  let onAbort: () => void = () => {};
  try {
    await Promise.race([sleep(ms), new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', onAbort); }
}
