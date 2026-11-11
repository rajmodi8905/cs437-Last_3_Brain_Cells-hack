// One confirmation for a burst of saves. Each saved message's reply is claimed before its title
// waits here, so a crash can lose a confirmation but nothing is ever confirmed twice.

export interface SaveBatchOptions<Sender> {
  /** Sends one confirmation for these titles to the sender. */
  send: (sender: Sender, titles: string[]) => Promise<void>;
  /** Saves confirmed together when they arrive within this long of each other. */
  batchMs: number;
  /** A burst's confirmation goes out once it has this many items. */
  batchMax: number;
  /** Runs `run` after `ms`; returns a cancel function. */
  schedule: (run: () => void, ms: number) => () => void;
  log: (message: string, detail?: unknown) => void;
  /** Logged when a confirmation cannot be sent. */
  failedMessage: string;
}

/** A real timer that does not keep the process alive. */
export const realSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

export function createSaveBatches<Sender>(options: SaveBatchOptions<Sender>) {
  const batches = new Map<string, { sender: Sender; titles: string[]; cancel?: () => void }>();
  /** Confirmations being sent right now, so `flush` and shutdown can wait for them. */
  const sending = new Set<Promise<void>>();

  function sendBatch(key: string) {
    const batch = batches.get(key);
    if (!batch) return Promise.resolve();
    batches.delete(key);
    batch.cancel?.();
    const sent: Promise<void> = options
      .send(batch.sender, batch.titles)
      .catch((cause: unknown) => options.log(options.failedMessage, cause))
      .finally(() => sending.delete(sent));
    sending.add(sent);
    return sent;
  }

  return {
    /** Adds a saved title for this sender (`key` is the vault's owner key). */
    async add(key: string, sender: Sender, title: string) {
      const batch = batches.get(key) ?? { sender, titles: [] };
      batches.set(key, batch);
      batch.titles.push(title);
      batch.cancel?.();
      if (batch.titles.length >= options.batchMax) return sendBatch(key);
      batch.cancel = options.schedule(() => void sendBatch(key), options.batchMs);
    },
    /** Drops a waiting confirmation without sending it (the vault is being erased). */
    drop(key: string) {
      batches.get(key)?.cancel?.();
      batches.delete(key);
    },
    /** Sends every waiting confirmation now and waits for those already being sent. */
    async flush() {
      for (const key of [...batches.keys()]) void sendBatch(key);
      while (sending.size) await Promise.all([...sending]);
    },
  };
}
