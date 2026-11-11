/// <reference types="node" />
// Telegram test fixtures: a stand-in for the Bot API on a local port (updates by long polling,
// files, messages, button answers, button removals and webhook settings), updates shaped like
// Telegram's documented examples, and Google-shaped ID tokens signed with a test key, which stand
// in for Google (as the development signer does). Nothing here calls Telegram or Google.
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Made up for these tests, in BotFather's format; never a real token. */
export const BOT_TOKEN = '123456789:TEST-fake-token-for-tests-only_0123456789';
export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

export interface SentMessage {
  method: string;
  chatId: number;
  text?: string;
  caption?: string;
  replyMarkup?: { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };
  file?: { bytes: Uint8Array; filename: string; mimeType: string };
  /** Milliseconds, from the stand-in's clock. */
  at: number;
}

interface StoredFile {
  bytes: Uint8Array;
  path: string;
  /** What getFile reports; the real size unless a test changes it. */
  size?: number;
}

export async function startFakeTelegram(token = BOT_TOKEN) {
  const files = new Map<string, StoredFile>();
  const state = {
    sent: [] as SentMessage[],
    answered: [] as { id: string; text?: string }[],
    /** Messages whose inline buttons were removed. */
    removed: [] as { chatId: number; messageId: number }[],
    /** Updates waiting for getUpdates; those below the requested offset are confirmed and go. */
    updates: [] as Record<string, unknown>[],
    offsets: [] as (number | undefined)[],
    getFileCalls: [] as string[],
    downloads: [] as string[],
    webhook: undefined as
      { url: string; secret_token: string; allowed_updates: string[] } | undefined,
    deleteWebhookCalls: 0,
    /** Sends answered with HTTP 500 before any succeeds. */
    failSends: 0,
    /** Sends answered with HTTP 429 and this retry_after before any succeeds. */
    rateLimits: [] as number[],
    /** getUpdates calls answered with HTTP 502 before any succeeds. */
    failGetUpdates: 0,
    /** Downloads answered with one byte missing. */
    truncateDownloads: 0,
    /** getFile answers "file is too big", as Telegram does over 20 MB. */
    fileTooBig: false,
    /** Every request path, to check none of them was unexpected. */
    paths: [] as string[],
  };
  const send = (res: import('node:http').ServerResponse, status: number, body: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const ok = (res: import('node:http').ServerResponse, result: unknown) =>
    send(res, 200, { ok: true, result });
  const fail = (
    res: import('node:http').ServerResponse,
    status: number,
    description: string,
    parameters?: Record<string, unknown>,
  ) =>
    send(res, status, {
      ok: false,
      error_code: status,
      description,
      ...(parameters ? { parameters } : {}),
    });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://telegram.local');
    state.paths.push(url.pathname);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);

    const file = /^\/file\/bot([^/]+)\/(.+)$/.exec(url.pathname);
    if (file && req.method === 'GET') {
      if (file[1] !== token) return fail(res, 401, 'Unauthorized');
      state.downloads.push(file[2]);
      const found = [...files.values()].find((stored) => stored.path === file[2]);
      if (!found) return fail(res, 404, 'Not Found');
      let bytes = found.bytes;
      if (state.truncateDownloads > 0) {
        state.truncateDownloads--;
        bytes = bytes.slice(0, -1);
      }
      res.writeHead(200, { 'content-length': String(bytes.length) });
      return res.end(bytes);
    }

    const call = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
    if (!call || req.method !== 'POST') return fail(res, 404, 'Not Found');
    if (call[1] !== token) return fail(res, 401, 'Unauthorized');
    const method = call[2];
    const type = req.headers['content-type'] ?? '';
    let body: Record<string, unknown> = {};
    let form: FormData | undefined;
    if (type.startsWith('multipart/form-data')) {
      form = await new Response(raw, { headers: { 'content-type': type } }).formData();
      form.forEach((value, key) => {
        if (typeof value === 'string') body[key] = value;
      });
    } else if (raw.length) body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;

    switch (method) {
      case 'getMe':
        return ok(res, { id: 123456789, is_bot: true, first_name: 'Test', username: 'test_bot' });
      case 'deleteWebhook':
        state.deleteWebhookCalls++;
        state.webhook = undefined;
        return ok(res, true);
      case 'setWebhook':
        state.webhook = body as typeof state.webhook;
        return ok(res, true);
      case 'getUpdates': {
        if (state.failGetUpdates > 0) {
          state.failGetUpdates--;
          return fail(res, 502, 'Bad Gateway');
        }
        if (state.webhook)
          return fail(res, 409, "Conflict: can't use getUpdates method while webhook is active");
        const offset = typeof body.offset === 'number' ? body.offset : undefined;
        state.offsets.push(offset);
        if (offset !== undefined)
          state.updates = state.updates.filter((u) => (u.update_id as number) >= offset);
        // Answers at once instead of waiting `timeout` seconds, to keep tests fast.
        return ok(res, state.updates.slice(0, 100));
      }
      case 'getFile': {
        const id = String(body.file_id);
        state.getFileCalls.push(id);
        if (state.fileTooBig) return fail(res, 400, 'Bad Request: file is too big');
        const found = files.get(id);
        if (!found) return fail(res, 400, 'Bad Request: invalid file_id');
        return ok(res, {
          file_id: id,
          file_unique_id: `u${id}`,
          ...(found.size !== undefined ? { file_size: found.size } : {}),
          file_path: found.path,
        });
      }
      case 'editMessageReplyMarkup': {
        const markup = body.reply_markup as { inline_keyboard?: unknown[] } | undefined;
        if (markup?.inline_keyboard?.length) return fail(res, 400, 'Bad Request: buttons left');
        state.removed.push({ chatId: Number(body.chat_id), messageId: Number(body.message_id) });
        return ok(res, true);
      }
      case 'answerCallbackQuery':
        state.answered.push({
          id: String(body.callback_query_id),
          ...(body.text ? { text: String(body.text) } : {}),
        });
        return ok(res, true);
      case 'sendMessage':
      case 'sendPhoto':
      case 'sendDocument': {
        if (state.rateLimits.length) {
          const retryAfter = state.rateLimits.shift()!;
          return fail(res, 429, `Too Many Requests: retry after ${retryAfter}`, {
            retry_after: retryAfter,
          });
        }
        if (state.failSends > 0) {
          state.failSends--;
          return fail(res, 500, 'Internal Server Error');
        }
        const field = method === 'sendPhoto' ? 'photo' : 'document';
        const upload = form?.get(field);
        const markup =
          typeof body.reply_markup === 'string'
            ? JSON.parse(body.reply_markup)
            : (body.reply_markup as SentMessage['replyMarkup']);
        state.sent.push({
          method,
          chatId: Number(body.chat_id),
          ...(typeof body.text === 'string' ? { text: body.text } : {}),
          ...(typeof body.caption === 'string' ? { caption: body.caption } : {}),
          ...(markup ? { replyMarkup: markup } : {}),
          ...(upload instanceof Blob
            ? {
                file: {
                  bytes: new Uint8Array(await upload.arrayBuffer()),
                  filename: upload instanceof File ? upload.name : '',
                  mimeType: upload.type,
                },
              }
            : {}),
          at: Date.now(),
        });
        return ok(res, {
          message_id: 1000 + state.sent.length,
          date: 0,
          chat: { id: body.chat_id },
        });
      }
      default:
        return fail(res, 404, 'Not Found: method not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let fileCount = 0;

  return {
    base,
    state,
    /** Makes a file available under `fileId`, as if a user had sent it. */
    addFile(fileId: string, bytes: Uint8Array, over: { size?: number } = {}) {
      files.set(fileId, {
        bytes,
        path: `documents/file_${++fileCount}.bin`,
        size: 'size' in over ? over.size : bytes.length,
      });
    },
    /** Messages sent to a chat. */
    to: (chatId: number) => state.sent.filter((sent) => sent.chatId === chatId),
    /** Texts sent to a chat (messages only). */
    textsTo: (chatId: number) =>
      state.sent
        .filter((sent) => sent.chatId === chatId && sent.method === 'sendMessage')
        .map((sent) => sent.text ?? ''),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface TgFrom {
  id: number;
  username?: string;
  first_name?: string;
}
export const USER_A: TgFrom = { id: 700_000_001, username: 'student_a', first_name: 'A' };
export const USER_B: TgFrom = { id: 700_000_002, username: 'student_b', first_name: 'B' };
export const USER_NO_NAME: TgFrom = { id: 700_000_003, first_name: 'C' };

let updateId = 500_000;
let messageId = 1;
let callbackId = 9_000_000;
export const nextUpdateId = () => ++updateId;

/** One update carrying a message from `from` in their private chat with the bot. */
export function messageUpdate(content: Record<string, unknown>, from: TgFrom = USER_A) {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++messageId,
      from: { is_bot: false, first_name: from.first_name ?? 'Student', ...from },
      chat: { id: from.id, type: 'private', first_name: from.first_name ?? 'Student' },
      date: 1_762_300_000,
      ...content,
    },
  };
}
export const textUpdate = (
  text: string,
  from: TgFrom = USER_A,
  over: Record<string, unknown> = {},
) => messageUpdate({ text, ...over }, from);
/** A forwarded text, as Telegram marks it since Bot API 7.0. */
export const forwardedUpdate = (text: string, from: TgFrom = USER_A) =>
  messageUpdate(
    {
      text,
      forward_origin: { type: 'hidden_user', sender_user_name: 'Someone', date: 1_762_200_000 },
    },
    from,
  );
/** A photo as Telegram sends it: several sizes of the same picture, smallest first. */
export function photoUpdate(
  sizes: { fileId: string; size: number; width: number; height: number }[],
  from: TgFrom = USER_A,
  caption?: string,
) {
  return messageUpdate(
    {
      photo: sizes.map((s) => ({
        file_id: s.fileId,
        file_unique_id: `u${s.fileId}`,
        file_size: s.size,
        width: s.width,
        height: s.height,
      })),
      ...(caption ? { caption } : {}),
    },
    from,
  );
}
export function documentUpdate(
  doc: { fileId: string; size?: number; mimeType: string; fileName?: string },
  from: TgFrom = USER_A,
  caption?: string,
) {
  return messageUpdate(
    {
      document: {
        file_id: doc.fileId,
        file_unique_id: `u${doc.fileId}`,
        mime_type: doc.mimeType,
        ...(doc.fileName ? { file_name: doc.fileName } : {}),
        ...(doc.size !== undefined ? { file_size: doc.size } : {}),
      },
      ...(caption ? { caption } : {}),
    },
    from,
  );
}
/** A tap on an inline button of a message the bot sent to `from`. */
export function callbackUpdate(data: string, from: TgFrom = USER_A) {
  return {
    update_id: ++updateId,
    callback_query: {
      id: String(++callbackId),
      from: { is_bot: false, first_name: from.first_name ?? 'Student', ...from },
      chat_instance: '-1234567890',
      message: { message_id: 1, chat: { id: from.id, type: 'private' }, date: 1_762_300_000 },
      data,
    },
  };
}

/** Bytes that look like a small JPEG. */
export const jpegBytes = (length = 5000, seed = 1) => {
  const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};
export const pdfBytes = (text = 'Guests need a pass. ') =>
  new TextEncoder().encode('%PDF-1.4\n' + text.repeat(200));

/** The test identity provider's key; its public half is what the pilot server trusts. */
export const ID_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const ID_KEY_ID = 'telegram-test-key';
export const CLIENT_ID = 'pilot-telegram-tests.apps.googleusercontent.com';

/** A Google-shaped ID token for `email`, signed with the test key. */
export function signIdToken(
  email: string,
  over: Record<string, unknown> = {},
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = part({ alg: 'RS256', kid: ID_KEY_ID, typ: 'JWT' });
  const payload = part({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: subjectOf(email),
    iat: nowSeconds - 10,
    exp: nowSeconds + 3000,
    email,
    email_verified: true,
    // Like Google, only Workspace accounts carry a hosted domain: here, the email's own.
    hd: email.slice(email.lastIndexOf('@') + 1).toLowerCase(),
    ...over,
  });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(ID_KEY.privateKey).toString('base64url')}`;
}
/** The subject the test identity provider gives an email, and so the vault `google:<sub>`. */
export const subjectOf = (email: string) =>
  `dev-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 24)}`;
export const ownerOf = (email: string) => `google:${subjectOf(email)}`;

/**
 * The app's own reasons for refusing to index an original, exactly as src/engine/extract.ts and
 * src/engine/index.ts word them (telegram-messages.test.ts checks they are still there). The
 * engine host passes them on unchanged.
 */
export const ENGINE_MESSAGES = {
  pageLimit: 'This PDF exceeds 50 pages. Split it into smaller documents.',
  password:
    'This PDF is password-protected. Remove the password (for example, print or export it to a new PDF) and add it again.',
  unreadablePdf: 'This PDF could not be read. Re-export or print it to a new PDF and add it again.',
  badImage:
    'This image could not be decoded. Re-save it as a JPEG, PNG or WebP file and add it again.',
  nothingSearchable:
    'No searchable content was extracted. The original is still saved and can be opened.',
};
