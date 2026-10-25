import { useEffect, useState } from 'react';
import type { LibraryItem } from '../shared';
import type { CampusRecallServices } from './services';
export function useLibraryItems(services: CampusRecallServices) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState('');
  useEffect(
    () =>
      services.subscribeLibrary(setItems, (cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      ),
    [services],
  );
  return { items, error };
}
