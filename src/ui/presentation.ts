import { FileAudio, FileImage, FileText, Film, Globe } from 'lucide-react';
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
export const kindIcons = {
  image: FileImage,
  pdf: FileText,
  note: FileText,
  webpage: Globe,
  audio: FileAudio,
  video: Film,
};
