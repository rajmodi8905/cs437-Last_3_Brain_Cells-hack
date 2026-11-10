/// <reference types="node" />
// BotStore on PostgreSQL, in the pilot schema (tables from migration 3 in ../postgres.ts). It
// shares the PilotStore's connections, so its writes join an open owner-lock transaction.
import type { PostgresPilotStore, Query } from '../postgres';
import type {
  BotJob,
  BotStore,
  InboundMessage,
  JobKind,
  JobState,
  OpenLink,
  SenderState,
  WaMessage,
  WhatsAppSender,
} from './store';
import { jobId } from './store';

interface LinkRow {
  token_hash: string;
  owner_key: string;
  label: string;
  created_at: string;
  expires_at: string;
}
const toLink = (row: LinkRow): OpenLink => ({
  tokenHash: row.token_hash,
  ownerKey: row.owner_key,
  label: row.label,
  createdAt: Number(row.created_at),
  expiresAt: Number(row.expires_at),
});
const optionalNumber = (value: string | null) => (value === null ? undefined : Number(value));

interface JobRow {
  id: string;
  kind: JobKind;
  wamid: string;
  owner_key: string;
  state: JobState;
  attempts: number;
  run_after: string;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
}
const JOB_COLUMNS =
  'id, kind, wamid, owner_key, state, attempts, run_after, locked_until, last_error, created_at';
const toJob = (row: JobRow): BotJob => ({
  id: row.id,
  kind: row.kind,
  wamid: row.wamid,
  ownerKey: row.owner_key,
  state: row.state,
  attempts: row.attempts,
  runAfter: Number(row.run_after),
  ...(row.locked_until !== null ? { lockedUntil: Number(row.locked_until) } : {}),
  ...(row.last_error !== null ? { lastError: row.last_error } : {}),
  createdAt: Number(row.created_at),
});

export class PostgresBotStore implements BotStore {
  constructor(private pilot: PostgresPilotStore) {}

  private run<T>(work: (db: Query) => Promise<T>) {
    return this.pilot.inTransaction(work);
  }

  async recordInbound(sender: WhatsAppSender, message: InboundMessage) {
    return this.run(async (db) => {
      const { rows } = await db.query<{ owner_key: string }>(
        `INSERT INTO wa_senders (user_id, owner_key, wa_id, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           wa_id = COALESCE(EXCLUDED.wa_id, wa_senders.wa_id),
           last_seen = GREATEST(wa_senders.last_seen, EXCLUDED.last_seen)
         RETURNING owner_key`,
        [sender.userId, sender.ownerKey, sender.waId ?? null, message.receivedAt],
      );
      const ownerKey = rows[0].owner_key;
      const inserted = await db.query(
        `INSERT INTO wa_inbound (wamid, sender_id, owner_key, received_at, message)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [
          message.wamid,
          sender.userId,
          ownerKey,
          message.receivedAt,
          JSON.stringify(message.message),
        ],
      );
      if (!inserted.rowCount) return false;
      await this.enqueue('ingest', message.wamid, ownerKey, message.receivedAt);
      return true;
    });
  }

  async getInbound(wamid: string): Promise<InboundMessage | undefined> {
    const { rows } = await this.run((db) =>
      db.query<{
        wamid: string;
        sender_id: string;
        owner_key: string;
        received_at: string;
        message: WaMessage;
      }>(
        'SELECT wamid, sender_id, owner_key, received_at, message FROM wa_inbound WHERE wamid = $1',
        [wamid],
      ),
    );
    const row = rows[0];
    return row
      ? {
          wamid: row.wamid,
          senderId: row.sender_id,
          ownerKey: row.owner_key,
          receivedAt: Number(row.received_at),
          message: row.message,
        }
      : undefined;
  }

  async getSender(userId: string): Promise<WhatsAppSender | undefined> {
    const { rows } = await this.run((db) =>
      db.query<{ user_id: string; owner_key: string; wa_id: string | null }>(
        'SELECT user_id, owner_key, wa_id FROM wa_senders WHERE user_id = $1',
        [userId],
      ),
    );
    const row = rows[0];
    return row
      ? { userId: row.user_id, ownerKey: row.owner_key, ...(row.wa_id ? { waId: row.wa_id } : {}) }
      : undefined;
  }

  async enqueue(kind: JobKind, wamid: string, ownerKey: string, now: number) {
    await this.run((db) =>
      db.query(
        `INSERT INTO wa_jobs (id, kind, wamid, owner_key, state, run_after, created_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, $5) ON CONFLICT DO NOTHING`,
        [jobId(kind, wamid), kind, wamid, ownerKey, now],
      ),
    );
  }

  async claimJob(kinds: JobKind[], now: number, leaseSeconds: number) {
    // SKIP LOCKED: a job another worker is claiming right now is passed over, not waited for.
    const { rows } = await this.run((db) =>
      db.query<JobRow>(
        `UPDATE wa_jobs SET state = 'running', attempts = attempts + 1, locked_until = $3
          WHERE id = (
            SELECT id FROM wa_jobs
             WHERE kind = ANY($1::text[])
               AND ((state = 'pending' AND run_after <= $2)
                 OR (state = 'running' AND locked_until <= $2))
             ORDER BY run_after, created_at, id
             LIMIT 1
             FOR UPDATE SKIP LOCKED)
          RETURNING ${JOB_COLUMNS}`,
        [kinds, now, now + leaseSeconds],
      ),
    );
    return rows[0] ? toJob(rows[0]) : undefined;
  }

  async getJob(id: string) {
    const { rows } = await this.run((db) =>
      db.query<JobRow>(`SELECT ${JOB_COLUMNS} FROM wa_jobs WHERE id = $1`, [id]),
    );
    return rows[0] ? toJob(rows[0]) : undefined;
  }

  /** Updates the job only while `job` is still the current claim. */
  private async update(job: BotJob, set: string, values: unknown[]) {
    await this.run((db) =>
      db.query(
        `UPDATE wa_jobs SET ${set}, locked_until = NULL
          WHERE id = $1 AND state = 'running' AND attempts = $2`,
        [job.id, job.attempts, ...values],
      ),
    );
  }
  async finishJob(job: BotJob) {
    await this.update(job, `state = 'done'`, []);
  }
  async retryJob(job: BotJob, error: string, runAfter: number) {
    await this.update(job, `state = 'pending', last_error = $3, run_after = $4`, [error, runAfter]);
  }
  async deferJob(job: BotJob, runAfter: number) {
    await this.update(job, `state = 'pending', attempts = attempts - 1, run_after = $3`, [
      runAfter,
    ]);
  }
  async failJob(job: BotJob, error: string) {
    await this.update(job, `state = 'failed', last_error = $3`, [error]);
  }

  async claimReply(wamid: string) {
    const { rowCount } = await this.run((db) =>
      db.query('UPDATE wa_inbound SET replied = true WHERE wamid = $1 AND NOT replied', [wamid]),
    );
    return rowCount === 1;
  }

  async senderState(userId: string): Promise<SenderState> {
    const { rows } = await this.run((db) =>
      db.query<{
        notice_sent_at: string | null;
        consented_at: string | null;
        notice_version: string | null;
        stopped_at: string | null;
        delete_requested_at: string | null;
      }>(
        `SELECT notice_sent_at, consented_at, notice_version, stopped_at, delete_requested_at
           FROM wa_senders WHERE user_id = $1`,
        [userId],
      ),
    );
    const row = rows[0];
    if (!row) return {};
    const state: SenderState = {
      noticeSentAt: optionalNumber(row.notice_sent_at),
      consentedAt: optionalNumber(row.consented_at),
      noticeVersion: row.notice_version ?? undefined,
      stoppedAt: optionalNumber(row.stopped_at),
      deleteRequestedAt: optionalNumber(row.delete_requested_at),
    };
    for (const key of Object.keys(state) as (keyof SenderState)[])
      if (state[key] === undefined) delete state[key];
    return state;
  }

  async claimNotice(userId: string, now: number) {
    const { rowCount } = await this.run((db) =>
      db.query(
        'UPDATE wa_senders SET notice_sent_at = $2 WHERE user_id = $1 AND notice_sent_at IS NULL',
        [userId, now],
      ),
    );
    return rowCount === 1;
  }
  async releaseNotice(userId: string) {
    await this.run((db) =>
      db.query('UPDATE wa_senders SET notice_sent_at = NULL WHERE user_id = $1', [userId]),
    );
  }
  async setConsent(userId: string, now: number, noticeVersion: string) {
    await this.run((db) =>
      db.query(
        `UPDATE wa_senders SET consented_at = $2, notice_version = $3, stopped_at = NULL
          WHERE user_id = $1`,
        [userId, now, noticeVersion],
      ),
    );
  }
  async setStopped(userId: string, at: number | undefined) {
    await this.run((db) =>
      db.query('UPDATE wa_senders SET stopped_at = $2 WHERE user_id = $1', [userId, at ?? null]),
    );
  }
  async setDeleteRequest(userId: string, at: number | undefined) {
    await this.run((db) =>
      db.query('UPDATE wa_senders SET delete_requested_at = $2 WHERE user_id = $1', [
        userId,
        at ?? null,
      ]),
    );
  }
  async forgetMessage(wamid: string) {
    await this.run((db) =>
      db.query(
        `UPDATE wa_inbound SET message = jsonb_strip_nulls(jsonb_build_object(
           'id', message->'id', 'type', message->'type')) WHERE wamid = $1`,
        [wamid],
      ),
    );
  }
  async forgetSender(userId: string, ownerKey: string) {
    await this.run(async (db) => {
      await db.query(
        `UPDATE wa_inbound SET message = jsonb_strip_nulls(jsonb_build_object(
           'id', message->'id', 'type', message->'type')) WHERE owner_key = $1`,
        [ownerKey],
      );
      await db.query(
        `UPDATE wa_jobs SET state = 'done', locked_until = NULL
          WHERE owner_key = $1 AND state IN ('pending', 'running')`,
        [ownerKey],
      );
      await db.query('DELETE FROM wa_links WHERE owner_key = $1', [ownerKey]);
      await db.query(
        `UPDATE wa_senders SET wa_id = NULL, notice_sent_at = NULL, consented_at = NULL,
           notice_version = NULL, stopped_at = NULL, delete_requested_at = NULL
          WHERE user_id = $1`,
        [userId],
      );
    });
  }
  async createLink(link: OpenLink) {
    await this.run((db) =>
      db.query(
        `INSERT INTO wa_links (token_hash, owner_key, label, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [link.tokenHash, link.ownerKey, link.label, link.createdAt, link.expiresAt],
      ),
    );
  }
  async peekLink(tokenHash: string, now: number) {
    const { rows } = await this.run((db) =>
      db.query<LinkRow>(
        `SELECT token_hash, owner_key, label, created_at, expires_at FROM wa_links
          WHERE token_hash = $1 AND expires_at > $2`,
        [tokenHash, now],
      ),
    );
    return rows[0] ? toLink(rows[0]) : undefined;
  }
  async takeLink(tokenHash: string, now: number) {
    // DELETE … RETURNING: of two concurrent uses, only one gets the row.
    const { rows } = await this.run((db) =>
      db.query<LinkRow>(
        `DELETE FROM wa_links WHERE token_hash = $1
         RETURNING token_hash, owner_key, label, created_at, expires_at`,
        [tokenHash],
      ),
    );
    const link = rows[0] && toLink(rows[0]);
    return link && link.expiresAt > now ? link : undefined;
  }
}
