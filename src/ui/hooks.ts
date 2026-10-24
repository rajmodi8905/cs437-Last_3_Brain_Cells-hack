import { useEffect, useState } from 'react';
export function useObjectUrl(blob?: Blob): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
export const bytes = (value: number) =>
  value < 1e6 ? `${Math.max(1, Math.round(value / 1000))} KB` : `${(value / 1e6).toFixed(1)} MB`;
export const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export const humanDate = (value: number) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(value);
export { downloadBlob } from '../app/download';
