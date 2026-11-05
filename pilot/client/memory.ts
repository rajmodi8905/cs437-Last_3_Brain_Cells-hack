/// <reference types="node" />
// In-memory library and sync state for tests. The app's adapters wrap Dexie instead.
import { createHash, randomUUID } from 'node:crypto';
import type { ItemKind, ItemStatus } from '../../src/shared';
import {
  emptySnapshot,
  type LocalItem,
  type LocalLibrary,
  type LocalSegment,
  type OfflineCopy,
  type OfflineStore,
  type RemoteIndexEntry,
  type RemoteIndexStore,
  type SyncSnapshot,
  type SyncStateStore,
} from './types';

export class MemoryLocalLibrary implements LocalLibrary {
  private items = new Map<
    string,
    {
      item: LocalItem;
      bytes: Uint8Array;
      index?: { indexVersion: string; segments: LocalSegment[] };
    }
  >();

  add(
    meta: { kind: ItemKind; title: string; mimeType: string; sourceUrl?: string },
    bytes: Uint8Array,
  ) {
    const id = randomUUID();
    this.items.set(id, {
      item: {
        ...meta,
        id,
        byteLength: bytes.length,
        contentSha256: createHash('sha256').update(bytes).digest('hex'),
        createdAt: 1_762_000_000_000 + this.items.size,
        status: 'ready',
      },
      bytes,
    });
    return id;
  }
  setTitle(id: string, title: string) {
    this.items.get(id)!.item.title = title;
  }
  remove(id: string) {
    this.items.delete(id);
  }
  setStatus(id: string, status: ItemStatus) {
    this.items.get(id)!.item.status = status;
  }
  /** Simulates the app finishing processing with these segments. */
  setIndex(id: string, indexVersion: string, segments: LocalSegment[]) {
    const entry = this.items.get(id)!;
    entry.index = { indexVersion, segments };
    entry.item.status = 'ready';
  }
  async getIndex(id: string) {
    const entry = this.items.get(id);
    return entry?.item.status === 'ready' ? entry.index : undefined;
  }
  titleOf(id: string) {
    return this.items.get(id)?.item.title;
  }
  async listItems() {
    return [...this.items.values()].map(({ item }) => ({ ...item }));
  }
  async getOriginal(id: string) {
    return this.items.get(id)?.bytes;
  }
  async renameItem(id: string, title: string) {
    this.setTitle(id, title);
  }
  async deleteItem(id: string) {
    this.remove(id);
  }
}

export class MemorySyncStateStore implements SyncStateStore {
  private snapshot = emptySnapshot();
  async load(): Promise<SyncSnapshot> {
    return structuredClone(this.snapshot);
  }
  async save(snapshot: SyncSnapshot) {
    this.snapshot = structuredClone(snapshot);
  }
}

export class MemoryRemoteIndexStore implements RemoteIndexStore {
  private entries = new Map<string, RemoteIndexEntry>();
  async get(globalId: string) {
    return this.entries.get(globalId);
  }
  async put(globalId: string, entry: RemoteIndexEntry) {
    this.entries.set(globalId, structuredClone(entry));
  }
  async delete(globalId: string) {
    this.entries.delete(globalId);
  }
  async all() {
    return [...this.entries].map(([globalId, entry]) => ({ globalId, ...entry }));
  }
}

export class MemoryOfflineStore implements OfflineStore {
  private copies = new Map<string, OfflineCopy>();
  async get(globalId: string) {
    return this.copies.get(globalId);
  }
  async put(globalId: string, copy: OfflineCopy) {
    this.copies.set(globalId, { ...copy, bytes: copy.bytes.slice() });
  }
  async delete(globalId: string) {
    this.copies.delete(globalId);
  }
  async keys() {
    return [...this.copies.keys()].sort();
  }
}
