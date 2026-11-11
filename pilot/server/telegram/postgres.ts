/// <reference types="node" />
// The Telegram channel's own state on PostgreSQL (`tg_state`, `tg_picks`, migration 5 in
// ../postgres.ts), sharing the PilotStore's connections like PostgresBotStore. Messages, jobs,
// sender state and links are a PostgresBotStore on the `tg_*` tables (TELEGRAM_TABLES).
import type { SourceLocation } from '../../../src/shared';
import type { PostgresPilotStore } from '../postgres';
import type { ResultPick, TelegramStateStore } from './store';

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
}
