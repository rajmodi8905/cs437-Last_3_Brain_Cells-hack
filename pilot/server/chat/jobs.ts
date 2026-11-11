// The job queue's worker side, shared by the chat channels: claim the next due job, run it, and
// retry failures with a doubling delay until the job fails for good.
import type { BotJob, BotStore, JobKind } from '../whatsapp/store';

/**
 * A job that would fail the same way every time, so it fails at once instead of being retried.
 * For an index job, `reply` replaces the usual message to the student.
 */
export class PermanentJobError extends Error {
  constructor(
    message: string,
    readonly reply?: string,
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export interface JobRunnerOptions {
  bot: BotStore;
  kinds: JobKind[];
  now: () => number;
  /** A claimed job is taken again after this long if its worker stopped. */
  leaseSeconds: number;
  /** Failed attempts before a job fails for good. */
  maxAttempts: number;
  /** Wait before attempt `attempt + 1`, in seconds. */
  retryDelay: (attempt: number) => number;
  log: (message: string, detail?: unknown) => void;
  /** Names the channel in log lines, for example `WhatsApp`. */
  label: string;
  /** Runs a claimed job; it finishes or defers the job itself. Throwing counts as a failure. */
  run: (job: BotJob) => Promise<void>;
  /** Called once a job has failed for good, after it was marked failed. */
  gaveUp: (job: BotJob, cause: unknown) => Promise<void>;
}

export const defaultRetryDelay = (attempt: number) => Math.min(3600, 30 * 2 ** (attempt - 1));

export function createJobRunner(options: JobRunnerOptions) {
  const { bot } = options;

  /** Runs one due job; false when there was none. */
  async function runOnce() {
    const job = await bot.claimJob(options.kinds, options.now(), options.leaseSeconds);
    if (!job) return false;
    try {
      await options.run(job);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      options.log(`${options.label} ${job.kind} job failed (attempt ${job.attempts})`, error);
      const permanent = cause instanceof PermanentJobError;
      if (job.attempts < options.maxAttempts && !permanent)
        await bot.retryJob(job, error, options.now() + options.retryDelay(job.attempts));
      else {
        await bot.failJob(job, error);
        await options.gaveUp(job, cause);
      }
    }
    return true;
  }

  /** Runs due jobs until none is left; for tests and one-off runs. */
  async function drain() {
    let count = 0;
    while (await runOnce()) count++;
    return count;
  }

  return { runOnce, drain };
}

/** Runs `runOnce` in this process until stopped; `wake` starts it on new work at once. */
export function startJobLoop(
  runOnce: () => Promise<boolean>,
  options: { idleMs: number; log: (message: string, detail?: unknown) => void; label: string },
) {
  let stopped = false;
  let woken = false;
  let wakeUp: (() => void) | undefined;
  const loop = (async () => {
    while (!stopped) {
      woken = false;
      const worked = await runOnce().catch((cause: unknown) => {
        options.log(`${options.label} worker error`, cause);
        return false;
      });
      if (worked || woken || stopped) continue;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, options.idleMs);
        wakeUp = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wakeUp = undefined;
    }
  })();
  return {
    wake() {
      woken = true;
      wakeUp?.();
    },
    async stop() {
      stopped = true;
      wakeUp?.();
      await loop;
    },
  };
}
