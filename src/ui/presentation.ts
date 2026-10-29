import type { ItemKind } from '../shared';
export const kinds: ItemKind[] = ['image', 'pdf', 'note', 'webpage', 'audio', 'video'];
export const kindLabels: Record<ItemKind, string> = {
  image: 'Images',
  pdf: 'PDFs',
  note: 'Notes',
  webpage: 'Webpages',
  audio: 'Audio',
  video: 'Video',
};
export const kindCodes: Record<ItemKind, string> = {
  image: 'Img',
  pdf: 'PDF',
  note: 'Note',
  webpage: 'Web',
  audio: 'Aud',
  video: 'Vid',
};
