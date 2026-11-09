// In-memory stores for tests and local development. Not durable; never use for the hosted pilot.
import type { CloudItem } from '../contract';
import {
  VaultResetError,
  publicItem,
  type Change,
  type CleanUpCutoffs,
  type LoginAttempt,
  type ObjectStore,
  type PilotStore,
  type SavedResponse,
  type Session,
  type StoredItem,
  type UploadRecord,
} from './store';

interface Vault {
  epoch: number;
  items: Map<string, StoredItem>;
  changes: Change[];
  responses: Map<string, SavedResponse & { savedAt: number }>;
}

export class MemoryPilotStore implements PilotStore {
  private ownerLocks = new Map<string, Promise<void>>();
  private vaults = new Map<string, Vault>();
  private sessions = new Map<string, Session>();
  private uploads = new Map<string, UploadRecord>();
  private attempts = new Map<string, LoginAttempt>();
  private received = new Map<string, Set<number>>();

  async withOwnerLock<T>(ownerKey: string, run: () => Promise<T>): Promise<T> {
    const previous = this.ownerLocks.get(ownerKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.ownerLocks.set(ownerKey, current);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (this.ownerLocks.get(ownerKey) === current) this.ownerLocks.delete(ownerKey);
    }
  }

  private vaultOf(ownerKey: string): Vault {
    let vault = this.vaults.get(ownerKey);
    if (!vault) {
      vault = { epoch: 1, items: new Map(), changes: [], responses: new Map() };
      this.vaults.set(ownerKey, vault);
    }
    return vault;
  }

  async vault(ownerKey: string) {
    return { epoch: this.vaultOf(ownerKey).epoch };
  }
  async createSession(session: Session) {
    this.sessions.set(session.id, session);
  }
  async getSession(id: string) {
    return this.sessions.get(id);
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async createLoginAttempt(attempt: LoginAttempt) {
    this.attempts.set(attempt.id, attempt);
  }
  async takeLoginAttempt(id: string) {
    const attempt = this.attempts.get(id);
    this.attempts.delete(id);
    return attempt;
  }
  async getItem(ownerKey: string, globalId: string) {
    return this.vaultOf(ownerKey).items.get(globalId);
  }
  async committedBytes(ownerKey: string) {
    let bytes = 0;
    for (const item of this.vaultOf(ownerKey).items.values())
      if (!item.deleted) bytes += item.byteLength + (item.indexBytes ?? 0);
    for (const upload of this.uploads.values())
      if (upload.ownerKey === ownerKey && !upload.result) bytes += upload.item.byteLength;
    return bytes;
  }
  async savedResponse(ownerKey: string, opId: string) {
    const saved = this.vaultOf(ownerKey).responses.get(opId);
    return saved && { status: saved.status, body: saved.body };
  }
  async saveResponse(
    ownerKey: string,
    opId: string,
    response: SavedResponse,
    savedAt = Math.floor(Date.now() / 1000),
  ) {
    const responses = this.vaultOf(ownerKey).responses;
    if (!responses.has(opId)) responses.set(opId, { ...response, savedAt });
  }
  async cleanUp(cutoffs: CleanUpCutoffs) {
    for (const [id, session] of this.sessions)
      if (session.expiresAt <= cutoffs.now) this.sessions.delete(id);
    for (const [id, attempt] of this.attempts)
      if (attempt.expiresAt <= cutoffs.now) this.attempts.delete(id);
    const abandoned: { uploadId: string; chunks: number[] }[] = [];
    for (const [id, upload] of this.uploads) {
      const old = upload.result
        ? upload.createdAt < cutoffs.finishedBefore
        : upload.createdAt < cutoffs.abandonedBefore;
      if (!old) continue;
      if (!upload.result) abandoned.push({ uploadId: id, chunks: await this.receivedChunks(id) });
      this.uploads.delete(id);
      this.received.delete(id);
    }
    for (const vault of this.vaults.values())
      for (const [opId, saved] of vault.responses)
        if (saved.savedAt < cutoffs.responsesBefore) vault.responses.delete(opId);
    return { abandoned };
  }
  async createUpload(upload: UploadRecord) {
    this.uploads.set(upload.uploadId, upload);
  }
  async getUpload(uploadId: string) {
    return this.uploads.get(uploadId);
  }
  async recordChunk(uploadId: string, n: number) {
    let set = this.received.get(uploadId);
    if (!set) this.received.set(uploadId, (set = new Set()));
    set.add(n);
  }
  async receivedChunks(uploadId: string) {
    return [...(this.received.get(uploadId) ?? [])].sort((a, b) => a - b);
  }
  async finishUpload(uploadId: string, result: CloudItem) {
    const upload = this.uploads.get(uploadId);
    if (upload) upload.result = result;
    this.received.delete(uploadId);
  }
  async publish(ownerKey: string, item: StoredItem, epoch: number) {
    const vault = this.vaultOf(ownerKey);
    if (vault.epoch !== epoch) throw new VaultResetError();
    vault.items.set(item.globalId, item);
    const change = { cursor: vault.changes.length + 1, item: publicItem(item) };
    vault.changes.push(change);
    return change;
  }
  async changesAfter(ownerKey: string, after: number) {
    const changes = this.vaultOf(ownerKey).changes;
    return { cursor: changes.length, changes: changes.slice(after) };
  }

  async resetVault(ownerKey: string) {
    const vault = this.vaultOf(ownerKey);
    const removed = [...vault.items.values()];
    vault.epoch += 1;
    vault.items.clear();
    vault.changes = [];
    vault.responses.clear();
    const abandoned: { uploadId: string; chunks: number[] }[] = [];
    for (const [id, upload] of this.uploads)
      if (upload.ownerKey === ownerKey) {
        if (!upload.result) abandoned.push({ uploadId: id, chunks: await this.receivedChunks(id) });
        this.uploads.delete(id);
        this.received.delete(id);
      }
    return { epoch: vault.epoch, removed: removed.filter((item) => !item.deleted), abandoned };
  }

  /** Test helper: which owner an upload belongs to. */
  uploadOwner(uploadId: string) {
    return this.uploads.get(uploadId)?.ownerKey;
  }
}

export class MemoryObjectStore implements ObjectStore {
  private objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes.slice());
  }
  async get(key: string, range?: { start: number; end: number }) {
    const bytes = this.objects.get(key);
    return bytes && range ? bytes.slice(range.start, range.end + 1) : bytes?.slice();
  }
  async list(prefix: string) {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
  async compose(target: string, parts: string[]) {
    const pieces = parts.map((key) => {
      const part = this.objects.get(key);
      if (!part) throw new Error(`Missing part ${key}`);
      return part;
    });
    const joined = new Uint8Array(pieces.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of pieces) {
      joined.set(part, at);
      at += part.length;
    }
    this.objects.set(target, joined);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
