// LocalLibrary over the app's existing repository; the repository itself is unchanged.
import type { IndexedSegment, LibraryRepository } from '../../src/shared';
import type { LocalLibrary } from './types';

export function repositoryLibrary(
  repository: Pick<
    LibraryRepository,
    'listItems' | 'getItem' | 'getOriginal' | 'renameItem' | 'deleteItem'
  >,
  /** Reads an item's stored search segments, such as from the app's Dexie `segments` table. */
  segmentsFor?: (itemId: string) => Promise<IndexedSegment[]>,
): LocalLibrary {
  return {
    async listItems() {
      return (await repository.listItems()).map(
        ({
          id,
          kind,
          title,
          mimeType,
          byteLength,
          contentSha256,
          createdAt,
          sourceUrl,
          status,
        }) => ({
          id,
          kind,
          title,
          mimeType,
          byteLength,
          contentSha256,
          createdAt,
          sourceUrl,
          status,
        }),
      );
    },
    async getOriginal(id) {
      const blob = await repository.getOriginal(id);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
    },
    async renameItem(id, title) {
      await repository.renameItem(id, title);
    },
    async deleteItem(id) {
      await repository.deleteItem(id);
    },
    getIndex: segmentsFor
      ? async (id) => {
          if ((await repository.getItem(id))?.status !== 'ready') return undefined;
          const segments = await segmentsFor(id);
          const versions = new Set(segments.map((segment) => segment.indexVersion));
          // Only a complete, single-version index is published.
          if (!segments.length || versions.size !== 1) return undefined;
          return {
            indexVersion: segments[0].indexVersion,
            segments: segments.map(({ modality, location, text, vector }) => ({
              modality,
              location,
              text,
              vector,
            })),
          };
        }
      : undefined,
  };
}
