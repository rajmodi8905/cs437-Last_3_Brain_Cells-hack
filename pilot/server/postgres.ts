/// <reference types="node" />
// PilotStore on PostgreSQL. Every multi-row change runs in one transaction; change cursors are
// allocated under a row lock on the account's vault, so they commit in order.
import pg from 'pg';
import type { CloudItem } from '../contract';
import {
  VaultResetError,
  publicItem,
  type Change,
  type CleanUpCutoffs,
  type LoginAttempt,
  type PilotStore,
  type SavedResponse,
  type Session,
  type StoredItem,
  type UploadRecord,
} from './store';

/** Applied in order, once each; never edit a released step, add a new one. */
const MIGRATIONS = [
  `
  CREATE TABLE vaults (
    owner_key text PRIMARY KEY,
    epoch integer NOT NULL DEFAULT 1,
    last_cursor bigint NOT NULL DEFAULT 0
  );
  CREATE TABLE items (
    owner_key text NOT NULL,
    global_id text NOT NULL,
    data jsonb NOT NULL,
    deleted boolean NOT NULL,
    byte_length bigint NOT NULL,
    PRIMARY KEY (owner_key, global_id)
  );
  CREATE TABLE changes (
    owner_key text NOT NULL,
    cursor bigint NOT NULL,
    item jsonb NOT NULL,
    PRIMARY KEY (owner_key, cursor)
  );
  CREATE TABLE responses (
    owner_key text NOT NULL,
    op_id text NOT NULL,
    status integer NOT NULL,
    body jsonb NOT NULL,
    PRIMARY KEY (owner_key, op_id)
  );
  CREATE TABLE uploads (
    upload_id text PRIMARY KEY,
    owner_key text NOT NULL,
    epoch integer NOT NULL,
    global_id text NOT NULL,
    item jsonb NOT NULL,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX uploads_open_by_owner ON uploads (owner_key) WHERE result IS NULL;
  CREATE TABLE upload_chunks (
    upload_id text NOT NULL REFERENCES uploads ON DELETE CASCADE,
    n integer NOT NULL,
    PRIMARY KEY (upload_id, n)
  );
  CREATE TABLE sessions (
    id text PRIMARY KEY,
    csrf text NOT NULL,
    owner_key text NOT NULL,
    email text NOT NULL,
    expires_at bigint NOT NULL
  );
  CREATE TABLE login_attempts (
    id text PRIMARY KEY,
    state text NOT NULL,
    nonce text NOT NULL,
    code_verifier text NOT NULL,
    expires_at bigint NOT NULL
  );
  `,
  // 2: times the clean-up uses, in seconds like the rest of the server.
  `
  ALTER TABLE uploads ADD COLUMN created_seconds bigint NOT NULL
    DEFAULT (extract(epoch FROM now()))::bigint;
  ALTER TABLE responses ADD COLUMN saved_at bigint NOT NULL
    DEFAULT (extract(epoch FROM now()))::bigint;
  CREATE INDEX uploads_created ON uploads (created_seconds);
  CREATE INDEX responses_saved ON responses (saved_at);
  CREATE INDEX sessions_expiry ON sessions (expires_at);
  CREATE INDEX login_attempts_expiry ON login_attempts (expires_at);
  `,
];

const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
type Query = Pick<pg.PoolClient, 'query'>;

export class PostgresPilotStore implements PilotStore {
  private constructor(
    private pool: pg.Pool,
    private schema: string,
  ) {}

  /** Connects, creates the schema if needed and applies pending migrations. */
  static async open(options: { connectionString: string; schema?: string; max?: number }) {
    const schema = options.schema ?? 'pilot';
    if (!SCHEMA.test(schema)) throw new Error('The schema name must be a plain lowercase name.');
    const pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.max ?? 10,
      options: `-c search_path=${schema}`,
    });
    const store = new PostgresPilotStore(pool, schema);
    try {
      await store.migrate();
    } catch (cause) {
      await pool.end();
      throw cause;
    }
    return store;
  }

  private async migrate() {
    await this.transaction(async (db) => {
      // One migrator at a time per schema, even with several server processes.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `pilot-migrate:${this.schema}`,
      ]);
      await db.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
      await db.query(
        `CREATE TABLE IF NOT EXISTS ${this.schema}.schema_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      const { rows } = await db.query<{ version: number }>(
        `SELECT version FROM ${this.schema}.schema_migrations`,
      );
      const applied = new Set(rows.map((row) => row.version));
      for (const [index, sql] of MIGRATIONS.entries()) {
        const version = index + 1;
        if (applied.has(version)) continue;
        await db.query(`SET LOCAL search_path TO ${this.schema}`);
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      }
    });
  }

  private async transaction<T>(run: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await run(db);
      await db.query('COMMIT');
      return result;
    } catch (cause) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally {
      db.release();
    }
  }

  /** The account's vault row, created at epoch 1 when first seen, locked for this transaction. */
  private async lockVault(db: Query, ownerKey: string) {
    await db.query('INSERT INTO vaults (owner_key) VALUES ($1) ON CONFLICT DO NOTHING', [ownerKey]);
    const { rows } = await db.query<{ epoch: number; last_cursor: string }>(
      'SELECT epoch, last_cursor FROM vaults WHERE owner_key = $1 FOR UPDATE',
      [ownerKey],
    );
    return { epoch: rows[0].epoch, lastCursor: Number(rows[0].last_cursor) };
  }

  async close() {
    await this.pool.end();
  }

  /** Tests only: removes everything this store created. */
  async dropSchemaForTests() {
    await this.pool.query(`DROP SCHEMA IF EXISTS ${this.schema} CASCADE`);
  }

  async vault(ownerKey: string): Promise<{ epoch: number }> {
    const { rows } = await this.pool.query<{ epoch: number }>(
      'SELECT epoch FROM vaults WHERE owner_key = $1',
      [ownerKey],
    );
    if (rows[0]) return { epoch: rows[0].epoch };
    await this.pool.query('INSERT INTO vaults (owner_key) VALUES ($1) ON CONFLICT DO NOTHING', [
      ownerKey,
    ]);
    return this.vault(ownerKey);
  }

  async createSession(session: Session) {
    await this.pool.query(
      'INSERT INTO sessions (id, csrf, owner_key, email, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [session.id, session.csrf, session.ownerKey, session.email, session.expiresAt],
    );
  }
  async getSession(id: string) {
    const { rows } = await this.pool.query(
      'SELECT id, csrf, owner_key, email, expires_at FROM sessions WHERE id = $1',
      [id],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          csrf: row.csrf,
          ownerKey: row.owner_key,
          email: row.email,
          expiresAt: Number(row.expires_at),
        }
      : undefined;
  }
  async deleteSession(id: string) {
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [id]);
  }

  async createLoginAttempt(attempt: LoginAttempt) {
    await this.pool.query(
      'INSERT INTO login_attempts (id, state, nonce, code_verifier, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [attempt.id, attempt.state, attempt.nonce, attempt.codeVerifier, attempt.expiresAt],
    );
  }
  async takeLoginAttempt(id: string) {
    const { rows } = await this.pool.query(
      'DELETE FROM login_attempts WHERE id = $1 RETURNING id, state, nonce, code_verifier, expires_at',
      [id],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          state: row.state,
          nonce: row.nonce,
          codeVerifier: row.code_verifier,
          expiresAt: Number(row.expires_at),
        }
      : undefined;
  }

  async getItem(ownerKey: string, globalId: string) {
    const { rows } = await this.pool.query<{ data: StoredItem }>(
      'SELECT data FROM items WHERE owner_key = $1 AND global_id = $2',
      [ownerKey, globalId],
    );
    return rows[0]?.data;
  }

  async committedBytes(ownerKey: string) {
    const { rows } = await this.pool.query<{ bytes: string }>(
      `SELECT
         (SELECT COALESCE(SUM(byte_length), 0) FROM items WHERE owner_key = $1 AND NOT deleted) +
         (SELECT COALESCE(SUM((item->>'byteLength')::bigint), 0)
            FROM uploads WHERE owner_key = $1 AND result IS NULL) AS bytes`,
      [ownerKey],
    );
    return Number(rows[0].bytes);
  }

  async savedResponse(ownerKey: string, opId: string) {
    const { rows } = await this.pool.query<SavedResponse>(
      'SELECT status, body FROM responses WHERE owner_key = $1 AND op_id = $2',
      [ownerKey, opId],
    );
    return rows[0] ? { status: rows[0].status, body: rows[0].body } : undefined;
  }
  async saveResponse(
    ownerKey: string,
    opId: string,
    response: SavedResponse,
    savedAt = Math.floor(Date.now() / 1000),
  ) {
    await this.pool.query(
      `INSERT INTO responses (owner_key, op_id, status, body, saved_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [ownerKey, opId, response.status, JSON.stringify(response.body), savedAt],
    );
  }

  async createUpload(upload: UploadRecord) {
    await this.pool.query(
      `INSERT INTO uploads (upload_id, owner_key, epoch, global_id, item, created_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        upload.uploadId,
        upload.ownerKey,
        upload.epoch,
        upload.globalId,
        JSON.stringify(upload.item),
        upload.createdAt,
      ],
    );
  }
  async getUpload(uploadId: string): Promise<UploadRecord | undefined> {
    const { rows } = await this.pool.query(
      `SELECT upload_id, owner_key, epoch, global_id, item, result, created_seconds
         FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      uploadId: row.upload_id,
      ownerKey: row.owner_key,
      epoch: row.epoch,
      globalId: row.global_id,
      item: row.item,
      createdAt: Number(row.created_seconds),
      ...(row.result ? { result: row.result } : {}),
    };
  }
  async recordChunk(uploadId: string, n: number) {
    await this.pool.query(
      'INSERT INTO upload_chunks (upload_id, n) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [uploadId, n],
    );
  }
  async receivedChunks(uploadId: string) {
    const { rows } = await this.pool.query<{ n: number }>(
      'SELECT n FROM upload_chunks WHERE upload_id = $1 ORDER BY n',
      [uploadId],
    );
    return rows.map((row) => row.n);
  }
  async finishUpload(uploadId: string, result: CloudItem) {
    await this.transaction(async (db) => {
      await db.query('UPDATE uploads SET result = $2 WHERE upload_id = $1', [
        uploadId,
        JSON.stringify(result),
      ]);
      await db.query('DELETE FROM upload_chunks WHERE upload_id = $1', [uploadId]);
    });
  }

  async publish(ownerKey: string, item: StoredItem, epoch: number): Promise<Change> {
    return this.transaction(async (db) => {
      const vault = await this.lockVault(db, ownerKey);
      if (vault.epoch !== epoch) throw new VaultResetError();
      const cursor = vault.lastCursor + 1;
      const visible = publicItem(item);
      await db.query(
        `INSERT INTO items (owner_key, global_id, data, deleted, byte_length)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (owner_key, global_id)
         DO UPDATE SET data = EXCLUDED.data, deleted = EXCLUDED.deleted, byte_length = EXCLUDED.byte_length`,
        [ownerKey, item.globalId, JSON.stringify(item), item.deleted, item.byteLength],
      );
      await db.query('INSERT INTO changes (owner_key, cursor, item) VALUES ($1, $2, $3)', [
        ownerKey,
        cursor,
        JSON.stringify(visible),
      ]);
      await db.query('UPDATE vaults SET last_cursor = $2 WHERE owner_key = $1', [ownerKey, cursor]);
      return { cursor, item: visible };
    });
  }

  async changesAfter(ownerKey: string, after: number) {
    const { rows } = await this.pool.query<{ cursor: string; item: Change['item'] }>(
      'SELECT cursor, item FROM changes WHERE owner_key = $1 AND cursor > $2 ORDER BY cursor',
      [ownerKey, after],
    );
    const changes = rows.map((row) => ({ cursor: Number(row.cursor), item: row.item }));
    // The cursor is the last change returned, so a change committed meanwhile is never skipped.
    return { cursor: changes.at(-1)?.cursor ?? after, changes };
  }

  async cleanUp(cutoffs: CleanUpCutoffs) {
    return this.transaction(async (db) => {
      await db.query('DELETE FROM sessions WHERE expires_at <= $1', [cutoffs.now]);
      await db.query('DELETE FROM login_attempts WHERE expires_at <= $1', [cutoffs.now]);
      const stale = await db.query<{ upload_id: string; finished: boolean; chunks: number[] }>(
        `SELECT u.upload_id, u.result IS NOT NULL AS finished,
                COALESCE(array_agg(c.n ORDER BY c.n) FILTER (WHERE c.n IS NOT NULL), '{}') AS chunks
           FROM uploads u LEFT JOIN upload_chunks c ON c.upload_id = u.upload_id
          WHERE (u.result IS NULL AND u.created_seconds < $1)
             OR (u.result IS NOT NULL AND u.created_seconds < $2)
          GROUP BY u.upload_id ORDER BY u.upload_id`,
        [cutoffs.abandonedBefore, cutoffs.finishedBefore],
      );
      await db.query('DELETE FROM uploads WHERE upload_id = ANY($1)', [
        stale.rows.map((row) => row.upload_id),
      ]);
      await db.query('DELETE FROM responses WHERE saved_at < $1', [cutoffs.responsesBefore]);
      return {
        abandoned: stale.rows
          .filter((row) => !row.finished)
          .map((row) => ({ uploadId: row.upload_id, chunks: row.chunks })),
      };
    });
  }

  async resetVault(ownerKey: string) {
    return this.transaction(async (db) => {
      const vault = await this.lockVault(db, ownerKey);
      const epoch = vault.epoch + 1;
      await db.query('UPDATE vaults SET epoch = $2, last_cursor = 0 WHERE owner_key = $1', [
        ownerKey,
        epoch,
      ]);
      const removed = await db.query<{ data: StoredItem }>(
        'DELETE FROM items WHERE owner_key = $1 RETURNING data',
        [ownerKey],
      );
      await db.query('DELETE FROM changes WHERE owner_key = $1', [ownerKey]);
      await db.query('DELETE FROM responses WHERE owner_key = $1', [ownerKey]);
      const open = await db.query<{ upload_id: string; chunks: number[] }>(
        `SELECT u.upload_id, COALESCE(array_agg(c.n ORDER BY c.n) FILTER (WHERE c.n IS NOT NULL), '{}') AS chunks
           FROM uploads u LEFT JOIN upload_chunks c ON c.upload_id = u.upload_id
          WHERE u.owner_key = $1 AND u.result IS NULL
          GROUP BY u.upload_id ORDER BY u.upload_id`,
        [ownerKey],
      );
      await db.query('DELETE FROM uploads WHERE owner_key = $1', [ownerKey]);
      return {
        epoch,
        removed: removed.rows.map((row) => row.data).filter((item) => !item.deleted),
        abandoned: open.rows.map((row) => ({ uploadId: row.upload_id, chunks: row.chunks })),
      };
    });
  }
}
