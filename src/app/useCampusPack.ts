import { useCallback, useEffect, useState } from 'react';
import { addCampusPack, missingCampusNotes } from './campusPack';
import { plainError } from './plainError';
import type { CampusRecallModel } from './useCampusRecall';

/** Whether to offer the IITGN campus pack, and the one-tap save that adds its missing notes. */
export function useCampusPack(model: CampusRecallModel) {
  const { services } = model;
  const [offered, setOffered] = useState(false);
  const refresh = useCallback(
    () =>
      missingCampusNotes(services).then(
        (missing) => setOffered(missing.length > 0),
        () => setOffered(false),
      ),
    [services],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const add = () =>
    model.perform('campus-pack', async () => {
      const { items, failure } = await addCampusPack(services);
      await refresh();
      // Saved notes are confirmed and indexed like any save; a failure part way says so, and
      // the offer stays so a second tap saves only the rest.
      if (items.length) model.saved(items, failure ? plainError(failure).message : undefined);
      else if (failure) throw failure;
    });
  return { offered, adding: model.busy === 'campus-pack', add };
}
