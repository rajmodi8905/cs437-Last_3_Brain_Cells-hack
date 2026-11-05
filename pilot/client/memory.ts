/// <reference types="node" />
// In-memory library and sync state for tests. The app's adapters wrap Dexie instead.
import { createHash, randomUUID } from 'node:crypto';
import type { ItemKind } from '../../src/shared';
import {
  emptySnapshot,
  type LocalItem,
  type LocalLibrary,
  type SyncSnapshot,
  type SyncStateStore,
} from './types';

export class MemoryLocalLibrary implements LocalLibrary {
  private items = new Map<string, { item: LocalItem; bytes: Uint8Array }>();

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
