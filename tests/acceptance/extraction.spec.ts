import { test, expect } from '@playwright/test';
import { prepare } from './helpers';
test.use({ trace: 'off' });
test('actual OCR, page extraction, ffmpeg decoding and timestamped English transcription', async ({
  page,
  context,
}) => {
  test.setTimeout(600000);
  const { external } = await prepare(page, context);
  const report = await page.evaluate(async () => {
    const h = (window as any).harness;
    const get = async (file: string) => {
      const r = await fetch(`/tests/fixtures/${file}`);
      return r.blob();
    };
    const image = await h.ocr(await get('sample-01.jpg'));
    const webp = await h.ocr(await get('ocr.webp'));
    const pdf = await h.extractPdf(
      await get('sample-03.pdf'),
      () => {},
      () => {},
    );
    const scan = await h.extractPdf(
      await get('scanned.pdf'),
      () => {},
      () => {},
    );
    const { ModelClient } = (window as any).harness;
    const models = new ModelClient();
    let audio;
    try {
      audio = await h.extractMedia(
        { kind: 'audio', mimeType: 'audio/mpeg' },
        await get('sample-09.mp3'),
        () => {},
      );
    } catch (cause: any) {
      throw Error(cause.message + ' ' + cause.cause, { cause });
    }
    const wav = await h.extractMedia(
      { kind: 'audio', mimeType: 'audio/wav' },
      await get('speech.wav'),
      () => {},
    );
    const transcript = await models.transcribe(audio.samples);
    const silence = await models.transcribe(new Float32Array(16000).fill(0.000001));
    const silent = await h.extractMedia(
      { kind: 'video', mimeType: 'video/mp4' },
      await get('sample-12.mp4'),
      () => {},
    );
    await models.dispose();
    return {
      image,
      webp,
      wavDuration: wav.durationMs,
      pdf: pdf.parts,
      scan: scan.parts,
      transcript,
      silence,
      duration: audio.durationMs,
      silent: silent.parts.map((p: any) => p.location),
      hasAudio: !!silent.samples,
    };
  });
  console.log('EXTRACTION', JSON.stringify(report));
  expect(external).toEqual([]);
  expect(report.image.toLowerCase()).toContain('badminton');
  expect(report.webp.toLowerCase()).toContain('badminton');
  expect(report.wavDuration).toBeGreaterThan(9000);
  expect(report.pdf.find((p: any) => p.location.page === 2)?.text).toContain('three students');
  expect(report.scan[0].text.toLowerCase()).toContain('badminton');
  expect(report.transcript.text.toLowerCase()).toContain('chess');
  expect(report.silence).toEqual({ text: '', chunks: [] });
  expect(report.transcript.chunks[0].timestamp[0]).toBeGreaterThanOrEqual(0);
  expect(report.silent).toHaveLength(2);
  expect(report.hasAudio).toBe(false);
});
