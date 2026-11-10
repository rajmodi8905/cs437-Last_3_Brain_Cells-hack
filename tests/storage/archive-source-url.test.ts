// A crafted backup must not give any kind of item a non-web source link, not only webpages
// (issue #44). The Viewer shows sourceUrl as a link for every kind.
import { expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage/index.js';

const archiveWith = async (kind: 'note' | 'pdf', sourceUrl: string) => {
  const id = crypto.randomUUID();
  const bytes =
    kind === 'note'
      ? new TextEncoder().encode('Lab moved to room 204.')
      : strToU8('%PDF-1.4\n%%EOF');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const manifest = {
    format: 'campus-recall',
    version: 1,
    exportedAt: Date.now(),
    items: [
      {
        id,
        kind,
        title: 'Crafted',
        mimeType: kind === 'note' ? 'text/plain;charset=utf-8' : 'application/pdf',
        byteLength: bytes.length,
        contentSha256: digest,
        createdAt: Date.now(),
        sourceUrl,
        originalPath: `originals/${id}`,
      },
    ],
  };
  const zip = zipSync({
    [`originals/${id}`]: bytes,
    'manifest.json': strToU8(JSON.stringify(manifest)),
  });
  const buffer = new ArrayBuffer(zip.byteLength);
  new Uint8Array(buffer).set(zip);
  return new Blob([buffer], { type: 'application/zip' });
};

it('rejects a non-web source link on any imported item kind', async () => {
  const repository = new DexieLibraryRepository(
    new CampusRecallDatabase(`test-${crypto.randomUUID()}`),
  );
  await repository.open();
  for (const kind of ['note', 'pdf'] as const)
    for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd'])
      await expect(
        repository.importArchive(await archiveWith(kind, sourceUrl)),
      ).rejects.toMatchObject({ detail: { code: 'INVALID_ARCHIVE' } });
  expect(await repository.listItems()).toHaveLength(0);
});

it('accepts only plain text as the type of an imported note', async () => {
  const repository = new DexieLibraryRepository(
    new CampusRecallDatabase(`test-${crypto.randomUUID()}`),
  );
  await repository.open();
  const noteWithType = async (mimeType: string) => {
    const id = crypto.randomUUID();
    const bytes = new TextEncoder().encode(`Mess timings ${mimeType}`);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const manifest = {
      format: 'campus-recall',
      version: 1,
      exportedAt: Date.now(),
      items: [
        {
          id,
          kind: 'note',
          title: 'Note',
          mimeType,
          byteLength: bytes.length,
          contentSha256: digest,
          createdAt: Date.now(),
          originalPath: `originals/${id}`,
        },
      ],
    };
    const zip = zipSync({
      [`originals/${id}`]: bytes,
      'manifest.json': strToU8(JSON.stringify(manifest)),
    });
    const buffer = new ArrayBuffer(zip.byteLength);
    new Uint8Array(buffer).set(zip);
    return new Blob([buffer], { type: 'application/zip' });
  };
  for (const bad of ['text/plain,text/html', 'text/plainx', 'text/plain; charset=utf-16'])
    await expect(repository.importArchive(await noteWithType(bad))).rejects.toMatchObject({
      detail: { code: 'INVALID_ARCHIVE' },
    });
  expect(await repository.listItems()).toHaveLength(0);
  for (const good of ['text/plain', 'text/plain;charset=utf-8', 'text/plain; charset=UTF-8'])
    await repository.importArchive(await noteWithType(good));
  expect(await repository.listItems()).toHaveLength(3);
});
