import { serveClient } from './static.ts';
import { COMPARISON_POLICY_VERSION } from '../comparison/compare.ts';
import { withComparisons, projectReferenceView } from '../comparison/views.ts';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ActiveRunError, EvidenceStore, LeaseError } from '../storage/store.ts';
import type { Run } from '../storage/store.ts';
import { CollectionService, ServiceUnavailableError } from '../collection/service.ts';

interface AppOptions {
  store: EvidenceStore;
  service: CollectionService;
  tokenConfigured: boolean;
  allowedOrigins?: string[];
  logger?: (entry: Record<string, unknown>) => void;
}
class HttpError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const idSchema = z.number().int().positive().safe();
const idsSchema = z.array(idSchema).min(1).max(25);
const selectionSchema = z.object({ projectIds: idsSchema }).strict();
const runSchema = z.object({ projectIds: idsSchema.optional() }).strict();
export function runView(run: Run, store: EvidenceStore) {
  const counts = { pending: 0, running: 0, complete: 0, partial: 0, failed: 0, interrupted: 0 };
  for (const project of run.projects) counts[project.state]++;
  const finished = counts.complete + counts.partial + counts.failed + counts.interrupted;
  return { ...withComparisons(store, run), progress: { total: run.projects.length, finished, ...counts,
    percent: Math.floor(finished / run.projects.length * 100) } };
}
export function createApplication(options: AppOptions) {
  const allowed = new Set(options.allowedOrigins ?? ['http://127.0.0.1:5173', 'http://localhost:5173']);
  const server = createServer((request, response) => {
    const requestId = randomUUID(); const started = Date.now();
    response.setHeader('X-Request-Id', requestId); response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, value: unknown) => { response.statusCode = status; response.end(JSON.stringify(value)); };
    const handler = async () => {
      const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0;
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!hosts.has(request.headers.host ?? '')) throw new HttpError(421, 'invalid_host', 'Use the local application address.');
      const origin = request.headers.origin;
      if (origin && !allowed.has(origin) && ![...hosts].some(host => origin === `http://${host}`)) throw new HttpError(403, 'origin_not_allowed', 'This browser origin is not allowed.');
      if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type'); send(204, null); return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const route = url.pathname; const method = request.method;
      if (method === 'GET' && route === '/health') { send(200, { status: 'ok', tokenConfigured: options.tokenConfigured }); return; }
      if (route === '/api/selection' && method === 'GET') { send(200, options.store.getSelection()); return; }
      if (route === '/api/selection' && method === 'PUT') {
        const parsed = selectionSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw new HttpError(400, 'invalid_selection', 'Supply projectIds as an array of 1-25 positive integer IDs.');
        options.store.saveSelection(parsed.data.projectIds); send(200, options.store.getSelection()); return;
      }
      if (route === '/api/runs' && method === 'POST') {
        if (!options.tokenConfigured) throw new HttpError(503, 'token_not_configured', 'Configure the server-side GITLAB_TOKEN before starting a collection.');
        const parsed = runSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw new HttpError(400, 'invalid_selection', 'Use an optional projectIds array of 1-25 positive integer IDs.');
        const ids = parsed.data.projectIds ?? options.store.getSelection().projectIds;
        if (!ids.length) throw new HttpError(400, 'selection_required', 'Save a project selection or supply projectIds.');
        const run = options.service.enqueue(ids);
        response.setHeader('Location', `/api/runs/${run.id}`); send(202, { run: runView(run, options.store) }); return;
      }
      if (route === '/api/runs' && method === 'GET') {
        send(200, { runs: options.store.listRuns(historyLimit(url)).map(run => runView(run, options.store)) }); return;
      }
      if (route === '/api/runs/active' && method === 'GET') {
        const run = options.store.getActiveRun(); send(200, { run: run ? runView(run, options.store) : null }); return;
      }
      const comparisonMatch = /^\/api\/runs\/([a-f0-9-]{36})\/comparisons$/.exec(route);
      if (comparisonMatch && method === 'GET') {
        const run = options.store.getRun(comparisonMatch[1]!);
        if (!run) throw new HttpError(404, 'run_not_found', 'Collection run was not found.');
        send(200, { policyVersion: COMPARISON_POLICY_VERSION, runId: run.id, projects: withComparisons(options.store, run).projects.map(project => ({ projectId: project.projectId, comparison: project.comparison })) }); return;
      }
      const runMatch = /^\/api\/runs\/([a-f0-9-]{36})$/.exec(route);
      if (runMatch && method === 'GET') {
        const run = options.store.getRun(runMatch[1]!);
        if (!run) throw new HttpError(404, 'run_not_found', 'Collection run was not found.');
        send(200, { run: runView(run, options.store) }); return;
      }
      const projectMatch = /^\/api\/projects\/([1-9]\d*)(\/history)?$/.exec(route);
      if (projectMatch && method === 'GET') {
        const id = idSchema.safeParse(Number(projectMatch[1]));
        if (!id.success) throw new HttpError(400, 'invalid_project_id', 'Project ID must be a positive safe integer.');
        if (projectMatch[2]) {
          send(200, { history: options.store.getProjectHistory(id.data, historyLimit(url)).map(reference => projectReferenceView(options.store, reference)) });
        } else {
          const state = options.store.getLatestProjectState(id.data);
          send(200, { latest: projectReferenceView(options.store, state.latest), lastComplete: projectReferenceView(options.store, state.lastComplete) });
        }
        return;
      }
      if (method === 'GET' && await serveClient(route, response)) return;
      throw new HttpError(404, 'not_found', 'Endpoint was not found.');
    };
    void handler().catch(error => {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof ActiveRunError) { send(409, { error: { code: 'run_already_active', message: error.message, requestId, activeRunId: error.runId } }); }
      else if (error instanceof LeaseError || error instanceof ServiceUnavailableError) send(503, { error: { code: 'collector_unavailable', message: error.message, requestId } });
      else if (error instanceof HttpError) {
        if (error.status === 413 || error.status === 408) response.setHeader('Connection', 'close');
        send(error.status, { error: { code: error.code, message: error.message, requestId } });
      } else send(500, { error: { code: 'internal_error', message: 'The request could not be completed. Check local storage and server status.', requestId } });
    });
    response.once('finish', () => options.logger?.({ event: 'http_request', requestId,
      method: request.method, status: response.statusCode, durationMs: Date.now() - started }));
  });
  server.headersTimeout = 5000; server.requestTimeout = 10_000; server.keepAliveTimeout = 1000;
  return server;
}
function historyLimit(url: URL): number {
  const raw = url.searchParams.get('limit') ?? '20';
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) throw new HttpError(400, 'invalid_limit', 'History limit must be between 1 and 100.');
  return Number(raw);
}
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'Use Content-Type: application/json.');
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const cleanup = () => { clearTimeout(timer); request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onAbort); };
    const fail = (error: HttpError) => { cleanup(); request.resume(); reject(error); };
    const onData = (chunk: Buffer) => { size += chunk.length; if (size > 16_384) fail(new HttpError(413, 'body_too_large', 'Request JSON must be at most 16 KiB.')); else chunks.push(chunk); };
    const onEnd = () => {
      cleanup();
      try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'invalid_json', 'Request body must contain valid JSON.')); }
    };
    const onError = () => fail(new HttpError(400, 'invalid_request', 'Request body could not be read.'));
    const onAbort = () => fail(new HttpError(400, 'request_aborted', 'Request was interrupted.'));
    const timer = setTimeout(() => fail(new HttpError(408, 'request_timeout', 'Request body took too long to arrive.')), 5000);
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onAbort);
  });
}
