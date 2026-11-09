import { useMemo, useSyncExternalStore } from 'react';
import type { CampusRecallServices } from '../../src/app/services';
import type { LibraryItem } from '../../src/shared';
import { Viewer } from '../../src/ui/Viewer';
import { fileNameFor, getAutoSync } from '../client/autosync';

/**
 * Opens a cloud item in the app's own viewer, at the page or time search found. The original
 * comes from this device's offline copy when there is one, otherwise from the cloud, and is
 * checked against its hash before it is shown.
 */
export function CloudViewer({
  services,
  notify,
}: {
  services: CampusRecallServices;
  /** Confirms a finished action, such as a download. */
  notify?: (message: string) => void;
}) {
  const controller = getAutoSync(services);
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  const globalId = view.opened?.globalId;
  const entry = view.cloudOnly.find((candidate) => candidate.globalId === globalId);
  const repository = useMemo(
    () => ({
      getOriginal: async () => (globalId ? (await controller.download(globalId)).blob : undefined),
    }),
    [controller, globalId],
  );
  if (!view.opened || !entry?.kind) return null;
  const item: LibraryItem = {
    id: `cloud:${entry.globalId}`,
    kind: entry.kind,
    title: entry.title ?? 'Cloud item',
    originalName: fileNameFor(entry),
    mimeType: entry.mimeType ?? 'application/octet-stream',
    byteLength: entry.byteLength ?? 0,
    contentSha256: entry.contentSha256 ?? '',
    originalBlobId: '',
    createdAt: entry.createdAt ?? 0,
    sourceUrl: entry.sourceUrl,
    status: 'ready',
    processingGeneration: 0,
  };
  return (
    <div className="preview-panel">
      <Viewer
        key={item.id}
        item={item}
        location={view.opened.location}
        repository={repository}
        onClose={() => controller.closeViewer()}
        onNotify={notify}
      />
    </div>
  );
}
