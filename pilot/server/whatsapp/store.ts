// Storage boundary for the WhatsApp channel (docs/pilot/whatsapp.md): inbound messages keyed by
// Meta's message ID, the job queue and sender identities. Items themselves live in PilotStore.
import { createHash } from 'node:crypto';

/** The parts of a Cloud API inbound message the channel reads; Meta sends more. */
export interface WaMedia {
  id?: string;
  mime_type?: string;
  /** Meta's SHA-256 of the file: base64 in webhooks, hex from some media lookups. */
  sha256?: string;
  caption?: string;
  filename?: string;
  /** Direct download URL (needs the access token); not present on every payload. */
  url?: string;
  voice?: boolean;
}

export interface WaMessage {
  id: string;
  from?: string;
  from_user_id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WaMedia;
  document?: WaMedia;
  audio?: WaMedia;
  video?: WaMedia;
  sticker?: WaMedia;
  context?: { forwarded?: boolean; frequently_forwarded?: boolean };
  errors?: { code?: number; title?: string }[];
  [field: string]: unknown;
}

/** Someone who messaged the bot. */
export interface WhatsAppSender {
  /** The business-scoped user ID (BSUID), or `phone-<hash>` for payloads without one. */
  userId: string;
  /** Vault owner: `wa:<userId>`. */
  ownerKey: string;
  /** Phone number as WhatsApp sends it, when it does; for display and replies only. */
  waId?: string;
}

export interface InboundMessage {
  wamid: string;
  senderId: string;
  ownerKey: string;
  /** When the webhook was recorded, in seconds. */
  receivedAt: number;
  message: WaMessage;
}

export type JobKind = 'ingest' | 'index';
export type JobState = 'pending' | 'running' | 'done' | 'failed';

export interface BotJob {
  /** `<kind>:<wamid>`, so each message has at most one job of each kind. */
  id: string;
  kind: JobKind;
  wamid: string;
  ownerKey: string;
  state: JobState;
  /** Claims so far; also identifies the current claim. */
  attempts: number;
  /** Seconds; the job is not claimed before this. */
  runAfter: number;
  /** Seconds; a running job whose lease has passed is claimed again (its worker stopped). */
  lockedUntil?: number;
  lastError?: string;
  createdAt: number;
}

export interface BotStore {
  /**
   * Records the sender and the message, and queues its ingest job, once per `wamid`. The
   * message is filed under the sender's stored owner key. Returns false (and changes nothing
   * but the sender's last-seen details) when the message is already known.
   */
  recordInbound(sender: WhatsAppSender, message: InboundMessage): Promise<boolean>;
  getInbound(wamid: string): Promise<InboundMessage | undefined>;
  getSender(userId: string): Promise<WhatsAppSender | undefined>;
  /** Queues a job unless the message already has one of that kind. */
  enqueue(kind: JobKind, wamid: string, ownerKey: string, now: number): Promise<void>;
  /**
   * Takes the next due job of these kinds for `leaseSeconds`, counting an attempt. Concurrent
   * callers never take the same job.
   */
  claimJob(kinds: JobKind[], now: number, leaseSeconds: number): Promise<BotJob | undefined>;
  getJob(id: string): Promise<BotJob | undefined>;
  /** The next calls change the job only while `job` is still the current claim. */
  finishJob(job: BotJob): Promise<void>;
  /** Back to pending until `runAfter`, keeping the error. */
  retryJob(job: BotJob, error: string, runAfter: number): Promise<void>;
  /** Back to pending until `runAfter` without counting this claim as an attempt. */
  deferJob(job: BotJob, runAfter: number): Promise<void>;
  /** Terminal: never claimed again. */
  failJob(job: BotJob, error: string): Promise<void>;
  /** Marks the message as answered; true only for the first caller, so each gets one reply. */
  claimReply(wamid: string): Promise<boolean>;
}

export const jobId = (kind: JobKind, wamid: string) => `${kind}:${wamid}`;
export const ownerKeyFor = (userId: string) => `wa:${userId}`;

/**
 * The sender's identity. Meta says to identify users by BSUID (`from_user_id`, or the
 * contact's `user_id`). Payloads from before BSUIDs have only the phone number; those senders
 * get an ID derived from it, kept apart from any BSUID because numbers can change hands.
 */
export function senderIdentity(ids: { bsuid?: string; waId?: string }): WhatsAppSender | undefined {
  const waId = ids.waId && /^\d{5,20}$/.test(ids.waId) ? ids.waId : undefined;
  // BSUIDs look like `US.13491208655302741918` (or `US.ENT.…` for parent IDs); anything
  // else is refused, since the ID becomes part of storage keys.
  const bsuid = ids.bsuid && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(ids.bsuid) ? ids.bsuid : '';
  const userId =
    bsuid || (waId ? `phone-${createHash('sha256').update(waId).digest('hex').slice(0, 32)}` : '');
  if (!userId) return undefined;
  return { userId, ownerKey: ownerKeyFor(userId), ...(waId ? { waId } : {}) };
}

const due = (job: BotJob, kinds: JobKind[], now: number) =>
  kinds.includes(job.kind) &&
  ((job.state === 'pending' && job.runAfter <= now) ||
    (job.state === 'running' && (job.lockedUntil ?? 0) <= now));

/** In-memory BotStore for tests and local development. Not durable. */
export class MemoryBotStore implements BotStore {
  private senders = new Map<string, WhatsAppSender & { lastSeen: number }>();
  private inbound = new Map<string, InboundMessage & { replied: boolean }>();
  private jobs = new Map<string, BotJob>();

  async recordInbound(sender: WhatsAppSender, message: InboundMessage) {
    const known = this.senders.get(sender.userId);
    const ownerKey = known?.ownerKey ?? sender.ownerKey;
    const waId = sender.waId ?? known?.waId;
    this.senders.set(sender.userId, {
      userId: sender.userId,
      ownerKey,
      ...(waId ? { waId } : {}),
      lastSeen: message.receivedAt,
    });
    if (this.inbound.has(message.wamid)) return false;
    this.inbound.set(message.wamid, {
      ...structuredClone(message),
      senderId: sender.userId,
      ownerKey,
      replied: false,
    });
    await this.enqueue('ingest', message.wamid, ownerKey, message.receivedAt);
    return true;
  }
  async getInbound(wamid: string) {
    const found = this.inbound.get(wamid);
    if (!found) return undefined;
    const { replied: _replied, ...message } = found;
    return structuredClone(message);
  }
  async getSender(userId: string) {
    const found = this.senders.get(userId);
    if (!found) return undefined;
    const { lastSeen: _lastSeen, ...sender } = found;
    return sender;
  }
  async enqueue(kind: JobKind, wamid: string, ownerKey: string, now: number) {
    const id = jobId(kind, wamid);
    if (this.jobs.has(id)) return;
    this.jobs.set(id, {
      id,
      kind,
      wamid,
      ownerKey,
      state: 'pending',
      attempts: 0,
      runAfter: now,
      createdAt: now,
    });
  }
  async claimJob(kinds: JobKind[], now: number, leaseSeconds: number) {
    const next = [...this.jobs.values()]
      .filter((job) => due(job, kinds, now))
      .sort(
        (a, b) => a.runAfter - b.runAfter || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
      )[0];
    if (!next) return undefined;
    next.state = 'running';
    next.attempts += 1;
    next.lockedUntil = now + leaseSeconds;
    return { ...next };
  }
  async getJob(id: string) {
    const job = this.jobs.get(id);
    return job && { ...job };
  }
  /** Applies `change` and releases the lease, only while `job` is the current claim. */
  private release(job: BotJob, change: Partial<BotJob>) {
    const stored = this.jobs.get(job.id);
    if (!stored || stored.state !== 'running' || stored.attempts !== job.attempts) return;
    const { lockedUntil: _lockedUntil, ...rest } = { ...stored, ...change };
    this.jobs.set(job.id, rest);
  }
  async finishJob(job: BotJob) {
    this.release(job, { state: 'done' });
  }
  async retryJob(job: BotJob, error: string, runAfter: number) {
    this.release(job, { state: 'pending', runAfter, lastError: error });
  }
  async deferJob(job: BotJob, runAfter: number) {
    this.release(job, { state: 'pending', runAfter, attempts: job.attempts - 1 });
  }
  async failJob(job: BotJob, error: string) {
    this.release(job, { state: 'failed', lastError: error });
  }
  async claimReply(wamid: string) {
    const found = this.inbound.get(wamid);
    if (!found || found.replied) return false;
    found.replied = true;
    return true;
  }
}
