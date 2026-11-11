// Long polling (polling mode, the default for a local trial): no public address is needed. The
// next offset is stored in the bot's state after each batch is recorded, so a restart neither
// loses nor repeats updates; a crash before that gets the batch again and dedupe drops it.
import { TelegramError, type TelegramApi } from './api';
import type { TelegramStateStore } from './store';

export interface TelegramPollingOptions {
  api: TelegramApi;
  state: TelegramStateStore;
  /** Records one update; true when it was new. */
  intake: (update: unknown) => Promise<boolean>;
  onRecorded?: () => void;
  /** How long one `getUpdates` waits for updates; 30 seconds. */
  timeoutSeconds?: number;
  /** Wait after the `failures`th failure in a row, in milliseconds; doubling from 1 s to 30 s. */
  retryMs?: (failures: number) => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (message: string, detail?: unknown) => void;
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** A short, token-free description of a failure for the log. */
export const describeFailure = (cause: unknown) =>
  cause instanceof TelegramError
    ? `${cause.message}${cause.description ? ` (${cause.description})` : ''}`
    : cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : 'unknown error';

export function createTelegramPoller(options: TelegramPollingOptions) {
  const timeoutSeconds = options.timeoutSeconds ?? 30;

  /** One `getUpdates` round: records the updates, then stores the next offset. */
  async function pollOnce(signal?: AbortSignal) {
    const offset = await options.state.getOffset();
    const updates = await options.api.getUpdates({
      ...(offset !== undefined ? { offset } : {}),
      timeoutSeconds,
      ...(signal ? { signal } : {}),
    });
    let next = offset;
    let recorded = 0;
    for (const update of updates) {
      if (!Number.isSafeInteger(update?.update_id)) continue;
      if (await options.intake(update)) recorded++;
      next = Math.max(next ?? 0, update.update_id + 1);
    }
    if (next !== undefined && next !== offset) await options.state.setOffset(next);
    if (recorded) options.onRecorded?.();
    return updates.length;
  }

  return { pollOnce };
}

/**
 * Polls until stopped. Webhook delivery is turned off first (`deleteWebhook`), because Telegram
 * refuses `getUpdates` while a webhook is set. Failures are logged without the token and retried
 * with a growing pause.
 */
export function startTelegramPolling(options: TelegramPollingOptions) {
  const { pollOnce } = createTelegramPoller(options);
  const log = options.log ?? ((message, detail) => console.error(message, detail));
  const retryMs = options.retryMs ?? ((n: number) => Math.min(30_000, 1000 * 2 ** (n - 1)));
  const sleep = options.sleep ?? abortableSleep;
  const controller = new AbortController();
  let stopped = false;
  const done = (async () => {
    let webhookOff = false;
    let failures = 0;
    while (!stopped) {
      try {
        if (!webhookOff) {
          await options.api.deleteWebhook();
          webhookOff = true;
        }
        await pollOnce(controller.signal);
        failures = 0;
      } catch (cause) {
        if (stopped) break;
        failures++;
        log('Telegram polling failed', describeFailure(cause));
        await sleep(retryMs(failures), controller.signal);
      }
    }
  })();
  return {
    async stop() {
      stopped = true;
      controller.abort();
      await done;
    },
  };
}
