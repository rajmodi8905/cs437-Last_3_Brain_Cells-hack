// LocalLibrary over the app's existing repository; the repository itself is unchanged.
import type { LibraryRepository } from '../../src/shared';
import type { LocalLibrary } from './types';

export function repositoryLibrary(
  repository: Pick<LibraryRepository, 'listItems' | 'getOriginal' | 'renameItem' | 'deleteItem'>,
): LocalLibrary {
  return {
    async listItems() {
      return (await repository.listItems()).map(
        ({ id, kind, title, mimeType, byteLength, contentSha256, createdAt, sourceUrl }) => ({
          id,
          kind,
          title,
          mimeType,
          byteLength,
          contentSha256,
          createdAt,
          sourceUrl,
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
  };
}
