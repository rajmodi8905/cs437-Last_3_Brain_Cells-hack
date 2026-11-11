/// <reference types="node" />
// The Telegram channel's own state on PostgreSQL (`tg_state` and `tg_picks`, migration 5;
// `tg_accounts`, `tg_saved` and the login and app links in `tg_links`, migration 6; see
// ../postgres.ts), sharing the PilotStore's connections like PostgresBotStore, so calls made under
// an owner's lock are part of its transaction. Messages, jobs and sender state are a
// PostgresBotStore on the `tg_*` tables (TELEGRAM_TABLES).
import type { SourceLocation } from '../../../src/shared';
import type { PostgresPilotStore } from '../postgres';
import type {
  ResultPick,
  TelegramAccount,
  TelegramLink,
  TelegramSaved,
  TelegramStateStore,
} from './store';

interface LinkRow {
  token_hash: string;
  purpose: string;
  user_id: string;
  owner_key: string;
  label: string;
  created_at: string;
  expires_at: string;
  message_id: string | null;
}
const LINK_COLUMNS =
  'token_hash, purpose, user_id, owner_key, label, created_at, expires_at, message_id';
const linkOf = (row: LinkRow): TelegramLink => ({
  tokenHash: row.token_hash,
  purpose: row.purpose === 'login' ? 'login' : 'open',
  userId: row.user_id,
  ownerKey: row.owner_key,
  label: row.label,
  createdAt: Number(row.created_at),
  expiresAt: Number(row.expires_at),
  ...(row.message_id !== null ? { messageId: Number(row.message_id) } : {}),
});

interface PickRow {
  token: string;
  owner_key: string;
  global_id: string;
  location: SourceLocation;
  expires_at: string;
}

export class PostgresTelegramStore implements TelegramStateStore {
  constructor(private pilot: PostgresPilotStore) {}

  async getOffset() {
    const { rows } = await this.pilot.inTransaction((db) =>
      db.query<{ value: string }>(`SELECT value FROM tg_state WHERE name = 'offset'`),
    );
    return rows[0] ? Number(rows[0].value) : undefined;
  }

  async setOffset(offset: number) {
    await this.pilot.inTransaction((db) =>
      db.query(
        `INSERT INTO tg_state (name, value) VALUES ('offset', $1)
         ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
        [offset],
      ),
    );
  }

  async createPicks(picks: ResultPick[], now: number) {
    await this.pilot.inTransaction(async (db) => {
      await db.query('DELETE FROM tg_picks WHERE expires_at <= $1', [now]);
      for (const pick of picks)
        await db.query(
          `INSERT INTO tg_picks (token, owner_key, global_id, location, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [pick.token, pick.ownerKey, pick.globalId, JSON.stringify(pick.location), pick.expiresAt],
        );
    });
  }

  async getPick(token: string, now: number) {
    const { rows } = await this.pilot.inTransaction((db) =>
      db.query<PickRow>(
        `SELECT token, owner_key, global_id, location, expires_at FROM tg_picks
          WHERE token = $1 AND expires_at > $2`,
        [token, now],
      ),
    );
    const row = rows[0];
    return row
      ? {
          token: row.token,
          ownerKey: row.owner_key,
          globalId: row.global_id,
          location: row.location,
          expiresAt: Number(row.expires_at),
        }
      : undefined;
  }

  async forgetOwner(ownerKey: string) {
    await this.pilot.inTransaction((db) =>
      db.query('DELETE FROM tg_picks WHERE owner_key = $1', [ownerKey]),
    );
  }

  async getAccount(userId: string): Promise<TelegramAccount | undefined> {
    const { rows } = await this.pilot.inTransaction((db) =>
      db.query<{ user_id: string; owner_key: string; email: string; linked_at: string }>(
        'SELECT user_id, owner_key, email, linked_at FROM tg_accounts WHERE user_id = $1',
        [userId],
      ),
    );
    const row = rows[0];
    return row
      ? {
          userId: row.user_id,
          ownerKey: row.owner_key,
          email: row.email,
          linkedAt: Number(row.linked_at),
        }
      : undefined;
  }

  async linkAccount(account: TelegramAccount) {
    await this.pilot.inTransaction((db) =>
      db.query(
        `INSERT INTO tg_accounts (user_id, owner_key, email, linked_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET owner_key = EXCLUDED.owner_key,
           email = EXCLUDED.email, linked_at = EXCLUDED.linked_at`,
        [account.userId, account.ownerKey, account.email, account.linkedAt],
      ),
    );
  }

  async unlinkAccount(userId: string) {
    await this.pilot.inTransaction((db) =>
      db.query('DELETE FROM tg_accounts WHERE user_id = $1', [userId]),
    );
  }

  async createLink(link: TelegramLink) {
    await this.pilot.inTransaction((db) =>
      db.query(`INSERT INTO tg_links (${LINK_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
        link.tokenHash,
        link.purpose,
        link.userId,
        link.ownerKey,
        link.label,
        link.createdAt,
        link.expiresAt,
        link.messageId ?? null,
      ]),
    );
  }

  async setLinkMessage(tokenHash: string, messageId: number) {
    await this.pilot.inTransaction((db) =>
      db.query('UPDATE tg_links SET message_id = $2 WHERE token_hash = $1', [tokenHash, messageId]),
    );
  }

  async peekLink(tokenHash: string, purpose: TelegramLink['purpose'], now: number) {
    const { rows } = await this.pilot.inTransaction((db) =>
      db.query<LinkRow>(
        `SELECT ${LINK_COLUMNS} FROM tg_links
          WHERE token_hash = $1 AND purpose = $2 AND user_id IS NOT NULL AND expires_at > $3`,
        [tokenHash, purpose, now],
      ),
    );
    return rows[0] ? linkOf(rows[0]) : undefined;
  }

  async takeLink(tokenHash: string, purpose: TelegramLink['purpose'], now: number) {
    const { rows } = await this.pilot.inTransaction((db) =>
      db.query<LinkRow>(
        `DELETE FROM tg_links WHERE token_hash = $1 AND purpose = $2 AND user_id IS NOT NULL
         RETURNING ${LINK_COLUMNS}`,
        [tokenHash, purpose],
      ),
    );
    const link = rows[0] && linkOf(rows[0]);
    return link && link.expiresAt > now ? link : undefined;
  }

  async revokeLinks(userId: string, purpose?: TelegramLink['purpose']) {
    const { rows } = await this.pilot.inTransaction((db) =>
      db.query<LinkRow>(
        `DELETE FROM tg_links WHERE user_id = $1 AND ($2::text IS NULL OR purpose = $2)
         RETURNING ${LINK_COLUMNS}`,
        [userId, purpose ?? null],
      ),
    );
    return rows.map(linkOf);
  }

  async recordSaved(saved: TelegramSaved) {
    await this.pilot.inTransaction((db) =>
      db.query(
        `INSERT INTO tg_saved (owner_key, global_id, user_id, saved_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [saved.ownerKey, saved.globalId, saved.userId, saved.savedAt],
      ),
    );
  }

  async savedItems(ownerKey: string) {
    const { rows } = await this.pilot.inTransaction((db) =>
      db.query<{ global_id: string }>(
        'SELECT global_id FROM tg_saved WHERE owner_key = $1 ORDER BY saved_at, global_id',
        [ownerKey],
      ),
    );
    return rows.map((row) => row.global_id);
  }

  async forgetSaved(ownerKey: string, globalIds: string[]) {
    if (!globalIds.length) return;
    await this.pilot.inTransaction((db) =>
      db.query('DELETE FROM tg_saved WHERE owner_key = $1 AND global_id = ANY($2::text[])', [
        ownerKey,
        globalIds,
      ]),
    );
  }
}
