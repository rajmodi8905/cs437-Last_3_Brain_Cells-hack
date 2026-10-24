export const runtime = (path: string) =>
  new URL(`runtime/${path}`, new URL(import.meta.env.BASE_URL, document.baseURI)).href;
let pdfModule: Promise<typeof import('pdfjs-dist')> | undefined;
export async function pdfjs() {
  const pdf = await (pdfModule ??= import('pdfjs-dist'));
  pdf.GlobalWorkerOptions.workerSrc = runtime('pdf.worker.min.mjs');
  return pdf;
}
