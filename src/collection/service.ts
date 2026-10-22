import { collectProject } from '../gitlab/collector.ts';
import { GitLabClient } from '../gitlab/client.ts';
import type { ProjectEvidence } from '../gitlab/types.ts';
import { ActiveRunError, EvidenceStore } from '../storage/store.ts';
import type { Run } from '../storage/store.ts';

type Logger = (entry: Record<string, unknown>) => void;
interface Options {
  store: EvidenceStore;
  clientFactory: (signal: AbortSignal) => GitLabClient;
  concurrency?: number;
  runTimeoutMs?: number;
  logger?: Logger;
  // Test seam for exceptional failures; production always uses the real collector.
  collector?: typeof collectProject;
}
export class CollectionService {
  #store: EvidenceStore;
  #clientFactory: Options['clientFactory'];
  #concurrency: number;
  #runTimeoutMs: number;
  #log: Logger;
  #collector: typeof collectProject;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #controller: AbortController | null = null;
  #task: Promise<void> | null = null;
  #closing = false;
  #started = false;
  constructor(options: Options) {
    this.#store = options.store; this.#clientFactory = options.clientFactory;
    this.#concurrency = options.concurrency ?? 3; this.#runTimeoutMs = options.runTimeoutMs ?? 120_000;
    this.#log = options.logger ?? (() => {}); this.#collector = options.collector ?? collectProject;
    if (!Number.isInteger(this.#concurrency) || this.#concurrency < 1 || this.#concurrency > 5) throw new Error('Concurrency must be 1-5.');
    if (!Number.isFinite(this.#runTimeoutMs) || this.#runTimeoutMs < 1 || this.#runTimeoutMs > 600_000) throw new Error('Invalid run deadline.');
  }
  start(): number {
    if (this.#started || this.#closing) throw new Error('Collector service cannot be started twice.');
    this.#store.acquireLease();
    try {
      const recovered = this.#store.recoverInterruptedRuns();
      this.#heartbeat = setInterval(() => {
        try { this.#store.renewLease(); }
        catch { this.#closing = true; this.#controller?.abort('lease_lost'); this.#log({ event: 'collector_lease_lost' }); }
      }, 3000);
      this.#heartbeat.unref(); this.#started = true;
      this.#log({ event: 'collector_started', recoveredRuns: recovered });
      return recovered;
    } catch (error) { this.#store.releaseLease(); throw error; }
  }
  enqueue(ids: number[]): Run {
    if (!this.#started || this.#closing) throw new ServiceUnavailableError();
    if (this.#task) throw new ActiveRunError(this.#store.getActiveRun()?.id ?? 'finishing');
    const run = this.#store.createRun(ids, true); // Committed before scheduling or acknowledging.
    const controller = new AbortController(); this.#controller = controller;
    this.#task = new Promise<void>(resolve => setImmediate(resolve))
      .then(() => this.#execute(run, controller))
      .finally(() => { this.#task = null; this.#controller = null; });
    return run;
  }
  async waitForIdle(): Promise<void> { await this.#task; }
  async stop(): Promise<void> {
    this.#closing = true; this.#controller?.abort('server_shutdown');
    try { await this.#task; }
    finally {
      if (this.#heartbeat) clearInterval(this.#heartbeat);
      if (this.#started) this.#store.releaseLease();
      this.#started = false;
    }
  }
  async #execute(run: Run, controller: AbortController): Promise<void> {
    const started = Date.now();
    const deadline = setTimeout(() => controller.abort('time_limit'), this.#runTimeoutMs);
    try {
      controller.signal.throwIfAborted();
      this.#store.startRun(run.id);
      const client = this.#clientFactory(controller.signal);
      let next = 0;
      const worker = async () => {
        while (!controller.signal.aborted) {
          const id = run.requestedProjectIds[next++]; if (id === undefined) return;
          this.#store.startProject(run.id, id);
          let evidence: ProjectEvidence;
          try { evidence = await this.#collector(client, id, snapshot => this.#store.checkpoint(run.id, snapshot)); }
          catch (error) { controller.abort(controller.signal.reason ?? 'execution_failure'); throw error; }
          controller.signal.throwIfAborted();
          this.#store.recordEvidence(run.id, evidence);
          this.#log({ event: 'project_collected', runId: run.id, projectId: id, outcome: evidence.outcome });
        }
      };
      // Join all workers before terminalizing the run, so late writes cannot race recovery.
      const settled = await Promise.allSettled(Array.from({ length: Math.min(this.#concurrency, run.requestedProjectIds.length) }, worker));
      if (settled.some(result => result.status === 'rejected')) throw new Error('Worker failed.');
      controller.signal.throwIfAborted(); this.#store.completeRun(run.id);
      this.#log({ event: 'run_completed', runId: run.id, durationMs: Date.now() - started });
    } catch {
      const reason = ['server_shutdown', 'time_limit', 'lease_lost'].includes(String(controller.signal.reason))
        ? String(controller.signal.reason) : 'execution_failure';
      try { this.#store.interruptRun(run.id, reason); }
      catch { this.#closing = true; this.#log({ event: 'run_recovery_required', runId: run.id }); }
      this.#log({ event: 'run_interrupted', runId: run.id, reason, durationMs: Date.now() - started });
    } finally { clearTimeout(deadline); }
  }
}

export class ServiceUnavailableError extends Error {
  constructor() { super('The collector is stopping or has lost ownership. Restart the server before collecting again.'); }
}
