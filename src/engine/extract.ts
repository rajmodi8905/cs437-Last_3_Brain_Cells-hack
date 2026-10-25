import type { LibraryItem, SourceLocation } from '../shared';
import { LIMITS } from '../shared';
export interface ExtractedPart {
  text?: string;
  image?: Blob;
  location: SourceLocation;
}
export interface Extracted {
  parts: ExtractedPart[];
  pageCount?: number;
  durationMs?: number;
  samples?: Float32Array;
}
import { runtime, pdfjs } from '../shared/browser-assets';
export { pdfjs } from '../shared/browser-assets';
export async function ocr(blob: Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    workerPath: runtime('ocr/worker.min.js'),
    corePath: runtime('ocr/tesseract-core-lstm.wasm.js'),
    langPath: runtime('ocr/'),
    cacheMethod: 'none',
    gzip: true,
  });
  try {
    const result = await worker.recognize(blob);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}
export async function extractPdf(
  blob: Blob,
  check: () => void,
  onPage: (n: number, total: number) => void,
): Promise<Extracted> {
  const pdf = await pdfjs();
  const task = pdf.getDocument({
    data: await blob.arrayBuffer(),
    useSystemFonts: true,
    useWasm: false,
  });
  try {
    const document = await task.promise;
    if (document.numPages > LIMITS.maxPdfPages)
      throw new Error('This PDF exceeds 50 pages. Split it into smaller documents.');
    const parts: ExtractedPart[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      check();
      onPage(page, document.numPages);
      const source = await document.getPage(page);
      const content = await source.getTextContent();
      const text = content.items
        .map((item) =>
          'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '',
        )
        .join('')
        .trim();
      if (text.length >= 30) parts.push({ text, location: { kind: 'page', page } });
      else {
        const viewport = source.getViewport({
          scale: Math.min(2, 1600 / source.getViewport({ scale: 1 }).width),
        });
        const canvas = documentCanvas(viewport.width, viewport.height);
        await source.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const image = await canvasBlob(canvas);
        const extracted = await ocr(image);
        check();
        if (extracted) parts.push({ text: extracted, location: { kind: 'page', page } });
        canvas.width = canvas.height = 0;
      }
      source.cleanup();
    }
    return { parts, pageCount: document.numPages };
  } finally {
    await task.destroy();
  }
}
const documentCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  return canvas;
};
const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not render page.'))),
      'image/png',
    ),
  );
export async function extractMedia(
  item: LibraryItem,
  blob: Blob,
  check: () => void,
): Promise<Extracted> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const logs: string[] = [];
  ffmpeg.on('log', ({ message }) => {
    logs.push(message);
    if (logs.length > 200) logs.shift();
  });
  try {
    await ffmpeg.load({
      classWorkerURL: runtime('ffmpeg/bridge/worker.js'),
      coreURL: runtime('ffmpeg/ffmpeg-core.js'),
      wasmURL: runtime('ffmpeg/ffmpeg-core.wasm'),
    });
    const name =
      item.kind === 'video'
        ? 'input.mp4'
        : item.mimeType.includes('wav')
          ? 'input.wav'
          : item.mimeType.includes('mpeg')
            ? 'input.mp3'
            : 'input.m4a';
    await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
    await ffmpeg.ffprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_name,codec_type',
      '-of',
      'json',
      name,
      '-o',
      'probe.json',
    ]);
    let probe: any;
    try {
      probe = JSON.parse(
        new TextDecoder().decode((await ffmpeg.readFile('probe.json')) as Uint8Array),
      );
    } catch {
      throw new Error('This media file could not be read. Convert it to a supported format.', {
        cause: logs.slice(-8).join('\n'),
      });
    }
    const durationMs = Number(probe.format?.duration) * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0)
      throw new Error('Media duration is unavailable.');
    const limit = item.kind === 'video' ? LIMITS.maxVideoDurationMs : LIMITS.maxAudioDurationMs;
    if (durationMs > limit + 1)
      throw new Error(
        `This ${item.kind} exceeds the ${item.kind === 'video' ? 'two' : 'five'} minute limit.`,
      );
    const streams = probe.streams ?? [];
    if (
      item.kind === 'video' &&
      (!streams.some((s: any) => s.codec_type === 'video' && s.codec_name === 'h264') ||
        streams.some((s: any) => s.codec_type === 'audio' && s.codec_name !== 'aac'))
    )
      throw new Error(
        'Convert this video to an H.264 MP4 with AAC audio. HEVC and MOV are outside this version.',
      );
    check();
    let samples: Float32Array | undefined;
    if (streams.some((s: any) => s.codec_type === 'audio')) {
      const code = await ffmpeg.exec([
        '-i',
        name,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        'f32le',
        'audio.f32',
      ]);
      if (code !== 0)
        throw new Error('Audio decoding failed. Convert to MP3, WAV or M4A and retry.');
      const bytes = (await ffmpeg.readFile('audio.f32')) as Uint8Array;
      samples = new Float32Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
    } else if (item.kind === 'audio') throw new Error('No audio stream was found.');
    const parts: ExtractedPart[] = [];
    if (item.kind === 'video')
      for (let startMs = 0; startMs < durationMs; startMs += 5000) {
        check();
        const code = await ffmpeg.exec([
          '-ss',
          String(startMs / 1000),
          '-i',
          name,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:-2',
          '-y',
          'frame.png',
        ]);
        if (code !== 0) throw new Error('A sampled video scene could not be decoded.');
        const bytes = (await ffmpeg.readFile('frame.png')) as Uint8Array;
        parts.push({
          image: new Blob([bytes.slice() as BlobPart], { type: 'image/png' }),
          location: { kind: 'time', startMs, endMs: Math.min(startMs + 5000, durationMs) },
        });
      }
    return { parts, durationMs, samples };
  } finally {
    ffmpeg.terminate();
  }
}
