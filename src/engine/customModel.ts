// S16: turns a Hugging Face model ID into a pinned list of files for a student's own model.
// The revision is pinned to the exact commit at that moment. Large (LFS) files are pinned by the
// SHA-256 that Hugging Face publishes; small files are downloaded once and hashed here. Setup then
// downloads and verifies those exact bytes, like EmbeddingGemma's files.
import { AppOperationError } from '../shared';
import { MAX_CUSTOM_MODEL_BYTES, type CustomModelFile } from '../shared/searchModels';

const HUB = 'https://huggingface.co';
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const REQUIRED = ['config.json', 'tokenizer.json', 'tokenizer_config.json'];
/** Small files are hashed here; anything bigger than this must be pinned by Hugging Face. */
const MAX_SMALL_FILE = 10_000_000;

export interface PinnedModel {
  repo: string;
  revision: string;
  dtype: 'q8' | 'fp32';
  files: CustomModelFile[];
}

const refuse = (message: string) =>
  new AppOperationError({ code: 'INVALID_INPUT', message, retryable: false });

async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}

export async function pinCustomModel(
  input: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<PinnedModel> {
  const repo = input
    .trim()
    .replace(/^https:\/\/huggingface\.co\//, '')
    .replace(/\/+$/, '');
  if (!MODEL_ID.test(repo) || repo.includes('..'))
    throw refuse('Enter a Hugging Face model ID such as "Xenova/bge-small-en-v1.5".');
  let response: Response;
  try {
    response = await fetcher(`${HUB}/api/models/${repo}/revision/main?blobs=true`, {
      credentials: 'omit',
    });
  } catch {
    throw new AppOperationError({
      code: 'SETUP_FAILED',
      message: 'Could not reach Hugging Face. Check your connection and try again.',
      retryable: true,
    });
  }
  if (response.status === 401 || response.status === 403)
    throw refuse(`${repo} needs a Hugging Face sign-in. Only public models can be added.`);
  if (!response.ok) throw refuse(`There is no public model called ${repo} on Hugging Face.`);
  const listing = (await response.json()) as {
    sha?: string;
    gated?: unknown;
    siblings?: Array<{
      rfilename: string;
      size?: number;
      lfs?: { sha256?: string; size?: number };
    }>;
  };
  if (listing.gated) throw refuse(`${repo} is gated. Only public models can be added.`);
  const revision = listing.sha ?? '';
  if (!/^[0-9a-f]{40}$/.test(revision)) throw refuse(`Hugging Face did not report a revision.`);
  const siblings = new Map((listing.siblings ?? []).map((file) => [file.rfilename, file]));
  const missing = REQUIRED.filter((name) => !siblings.has(name));
  if (missing.length)
    throw refuse(`${repo} has no ${missing.join(' or ')}, so it cannot run in the browser.`);
  // Prefer the 8-bit file: smaller to download and faster on phones.
  const onnx = siblings.has('onnx/model_quantized.onnx')
    ? { name: 'onnx/model_quantized.onnx', dtype: 'q8' as const }
    : siblings.has('onnx/model.onnx')
      ? { name: 'onnx/model.onnx', dtype: 'fp32' as const }
      : undefined;
  if (!onnx)
    throw refuse(
      `${repo} has no ONNX export (onnx/model.onnx), so it cannot run in the browser. Models from "Xenova/" or "onnx-community/" usually have one.`,
    );
  if (siblings.has(`${onnx.name}_data`))
    throw refuse(`${repo} splits its weights into several files, which is not supported.`);
  const files: CustomModelFile[] = [];
  for (const name of [...REQUIRED, onnx.name]) {
    const entry = siblings.get(name)!;
    const url = `${HUB}/${repo}/resolve/${revision}/${name}`;
    if (entry.lfs?.sha256 && Number.isSafeInteger(entry.lfs.size)) {
      files.push({ name, url, bytes: entry.lfs.size!, sha256: entry.lfs.sha256 });
      continue;
    }
    if (!(entry.size! > 0) || entry.size! > MAX_SMALL_FILE)
      throw refuse(`Hugging Face did not report a usable size for ${name}.`);
    const download = await fetcher(url, { credentials: 'omit' });
    if (!download.ok) throw refuse(`Could not download ${name} from ${repo}.`);
    const bytes = await download.arrayBuffer();
    if (bytes.byteLength !== entry.size) throw refuse(`${name} from ${repo} has the wrong size.`);
    files.push({ name, url, bytes: bytes.byteLength, sha256: await sha256(bytes) });
  }
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > MAX_CUSTOM_MODEL_BYTES)
    throw refuse(
      `${repo} is ${Math.round(total / 1e6)} MB. Models up to ${MAX_CUSTOM_MODEL_BYTES / 1e6} MB can be added.`,
    );
  return { repo, revision, dtype: onnx.dtype, files };
}
