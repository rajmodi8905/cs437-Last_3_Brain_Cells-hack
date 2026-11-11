/// <reference types="node" />
// The few Telegram Bot API calls the channel makes (https://core.telegram.org/bots/api): updates
// by long polling or webhook, file downloads, and text, photo and document messages with inline
// buttons. The bot token is part of every Bot API URL, so no URL, request option or underlying
// error leaves this file: errors carry only the method, the HTTP status and Telegram's own
// description, and anything that could contain the token is removed.
import { MediaTooLargeError } from '../whatsapp/graph';

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}
export interface TgChat {
  id: number;
  type: string;
}
export interface TgPhotoSize {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}
/** A document, voice note, audio, video or sticker; only the fields the channel reads. */
export interface TgFile {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  /** Seconds. */
  date: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: TgFile;
  voice?: TgFile;
  audio?: TgFile;
  video?: TgFile;
  video_note?: TgFile;
  animation?: TgFile;
  sticker?: TgFile;
  /** Set on forwarded messages (Bot API 7.0 and later). */
  forward_origin?: { type?: string; date?: number };
  /** Older form of the same, still accepted. */
  forward_date?: number;
  [field: string]: unknown;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: { message_id?: number; chat?: TgChat };
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  [field: string]: unknown;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}
/** A file to upload with a message. */
export interface UploadFile {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

/** Only these update types are asked for; everything else (edits, groups' extras) is skipped. */
export const ALLOWED_UPDATES = ['message', 'callback_query'];

export interface TelegramApi {
  getMe(): Promise<{ id: number; username?: string }>;
  /** Long polling: waits up to `timeoutSeconds` for updates after `offset`. */
  getUpdates(input: {
    offset?: number;
    timeoutSeconds: number;
    signal?: AbortSignal;
  }): Promise<TgUpdate[]>;
  /** Ends webhook delivery, which long polling needs; pending updates are kept. */
  deleteWebhook(): Promise<void>;
  setWebhook(input: { url: string; secretToken: string }): Promise<void>;
  /** A file's path for downloading; Telegram serves files up to 20 MB this way. */
  getFile(fileId: string): Promise<{ filePath?: string; fileSize?: number }>;
  /** The file at a path from `getFile`; refused beyond `maxBytes`. */
  download(filePath: string, maxBytes: number): Promise<Uint8Array>;
  sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  sendPhoto(chatId: number, file: UploadFile, caption?: string): Promise<void>;
  sendDocument(chatId: number, file: UploadFile, caption?: string): Promise<void>;
  /** Acknowledges a button tap, optionally with a short notice shown in the app. */
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

/** A Bot API call that did not succeed. Never holds a URL or the token. */
export class TelegramError extends Error {
  constructor(
    readonly method: string,
    /** HTTP status, or 0 when the request did not get an answer. */
    readonly status: number,
    message: string,
    /** Telegram's own `description`, for the log. */
    readonly description?: string,
    /** Seconds Telegram asked to wait (HTTP 429). */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

export interface TelegramApiOptions {
  /** The bot token from BotFather; server-side only, never logged. */
  token: string;
  /** `https://api.telegram.org` by default; tests point it at a stand-in. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /**
   * Messages to one chat are spaced at least this far apart: Telegram allows about one message
   * a second per chat. 1000 by default.
   */
  minIntervalMs?: number;
  /** Times a call answered with HTTP 429 is tried again after Telegram's `retry_after`; 2. */
  maxRetries?: number;
  /** Longest `retry_after` honoured before giving up, in seconds; 60. */
  maxRetryAfterSeconds?: number;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTelegramApi(options: TelegramApiOptions): TelegramApi {
  const fetchImpl = options.fetch ?? fetch;
  const base = (options.baseUrl ?? 'https://api.telegram.org').replace(/\/$/, '');
  const { token } = options;
  const interval = options.minIntervalMs ?? 1000;
  const maxRetries = options.maxRetries ?? 2;
  const maxRetryAfter = options.maxRetryAfterSeconds ?? 60;
  const sleep = options.sleep ?? realSleep;
  const nowMs = options.nowMs ?? Date.now;
  /** Removes the token from text that came from elsewhere, to be sure. */
  const redact = (text: string) => (token ? text.split(token).join('<token>') : text);

  /** Why a request got no answer, without its URL: only a plain error code. */
  const networkReason = (cause: unknown) => {
    if (cause instanceof Error && cause.name === 'AbortError') return 'it was stopped';
    const inner = (cause as { cause?: { code?: unknown } } | undefined)?.cause?.code;
    const code = (cause as { code?: unknown } | undefined)?.code ?? inner;
    return typeof code === 'string' && /^[A-Z_]{2,40}$/.test(code)
      ? `a network error (${code})`
      : 'a network error';
  };

  async function request(method: string, url: string, init: RequestInit) {
    try {
      return await fetchImpl(url, init);
    } catch (cause) {
      // The underlying error is dropped on purpose: it can name the URL, and the URL holds the
      // token.
      throw new TelegramError(
        method,
        0,
        `Telegram ${method} got no answer: ${networkReason(cause)}.`,
      );
    }
  }

  /** One Bot API call; HTTP 429 is waited out and tried again a few times. */
  async function call<T>(
    method: string,
    body: Record<string, unknown> | FormData,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const form = body instanceof FormData;
      const res = await request(method, `${base}/bot${token}/${method}`, {
        method: 'POST',
        ...(form ? {} : { headers: { 'content-type': 'application/json' } }),
        body: form ? body : JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      let parsed: {
        ok?: boolean;
        result?: unknown;
        description?: unknown;
        parameters?: { retry_after?: unknown };
      } = {};
      try {
        parsed = (await res.json()) as typeof parsed;
      } catch {
        // Not JSON: only the status is kept.
      }
      if (res.ok && parsed.ok === true) return parsed.result as T;
      const description =
        typeof parsed.description === 'string' ? redact(parsed.description.slice(0, 300)) : '';
      const retryAfter = Number(parsed.parameters?.retry_after);
      const error = new TelegramError(
        method,
        res.status,
        `Telegram ${method} failed with HTTP ${res.status}.`,
        description || undefined,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
      if (
        res.status !== 429 ||
        attempt >= maxRetries ||
        !Number.isFinite(retryAfter) ||
        retryAfter > maxRetryAfter
      )
        throw error;
      await sleep(Math.max(0, retryAfter) * 1000);
    }
  }

  // One queue per chat, so each chat gets at most one message per `interval`.
  const queues = new Map<number, Promise<void>>();
  const lastSent = new Map<number, number>();
  async function spaced(chatId: number, send: () => Promise<void>) {
    const previous = queues.get(chatId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => mine);
    queues.set(chatId, tail);
    await previous;
    try {
      const wait = (lastSent.get(chatId) ?? -Infinity) + interval - nowMs();
      if (wait > 0) await sleep(wait);
      await send();
    } finally {
      lastSent.set(chatId, nowMs());
      if (lastSent.size > 1000)
        for (const [chat, at] of lastSent) if (nowMs() - at > interval) lastSent.delete(chat);
      if (queues.get(chatId) === tail) queues.delete(chatId);
      release();
    }
  }

  const upload = (
    method: 'sendPhoto' | 'sendDocument',
    field: 'photo' | 'document',
    chatId: number,
    file: UploadFile,
    caption?: string,
  ) =>
    spaced(chatId, async () => {
      const form = new FormData();
      form.set('chat_id', String(chatId));
      if (caption) form.set('caption', caption);
      form.set(
        field,
        new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
        file.filename,
      );
      await call(method, form);
    });

  return {
    async getMe() {
      const me = await call<{ id: number; username?: string }>('getMe', {});
      return { id: me.id, ...(me.username ? { username: me.username } : {}) };
    },

    async getUpdates({ offset, timeoutSeconds, signal }) {
      const updates = await call<TgUpdate[]>(
        'getUpdates',
        {
          ...(offset !== undefined ? { offset } : {}),
          timeout: timeoutSeconds,
          allowed_updates: ALLOWED_UPDATES,
        },
        signal,
      );
      return Array.isArray(updates) ? updates : [];
    },

    async deleteWebhook() {
      await call('deleteWebhook', { drop_pending_updates: false });
    },

    async setWebhook({ url, secretToken }) {
      await call('setWebhook', {
        url,
        secret_token: secretToken,
        allowed_updates: ALLOWED_UPDATES,
        drop_pending_updates: false,
      });
    },

    async getFile(fileId) {
      const file = await call<{ file_path?: unknown; file_size?: unknown }>('getFile', {
        file_id: fileId,
      });
      return {
        ...(typeof file.file_path === 'string' ? { filePath: file.file_path } : {}),
        ...(typeof file.file_size === 'number' ? { fileSize: file.file_size } : {}),
      };
    },

    async download(filePath, maxBytes) {
      // Telegram's paths look like `photos/file_12.jpg`; anything else is refused before use.
      if (!/^[A-Za-z0-9_./-]{1,512}$/.test(filePath) || filePath.includes('..'))
        throw new TelegramError('download', 0, 'Telegram gave an unusable file path.');
      const res = await request('download', `${base}/file/bot${token}/${filePath}`, {});
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new TelegramError(
          'download',
          res.status,
          `Telegram file download failed with HTTP ${res.status}.`,
        );
      }
      const declared = Number(res.headers.get('content-length'));
      if (declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new MediaTooLargeError();
      }
      // Read in pieces and stop as soon as the limit is passed.
      const parts: Uint8Array[] = [];
      let size = 0;
      const reader = res.body?.getReader();
      while (reader) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (cause) {
          throw new TelegramError(
            'download',
            0,
            `Telegram file download broke off: ${networkReason(cause)}.`,
          );
        }
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new MediaTooLargeError();
        }
        parts.push(chunk.value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const part of parts) {
        bytes.set(part, at);
        at += part.length;
      }
      return bytes;
    },

    sendMessage(chatId, text, keyboard) {
      return spaced(chatId, async () => {
        await call('sendMessage', {
          chat_id: chatId,
          text,
          link_preview_options: { is_disabled: true },
          ...(keyboard ? { reply_markup: keyboard } : {}),
        });
      });
    },

    sendPhoto: (chatId, file, caption) => upload('sendPhoto', 'photo', chatId, file, caption),
    sendDocument: (chatId, file, caption) =>
      upload('sendDocument', 'document', chatId, file, caption),

    async answerCallbackQuery(callbackQueryId, text) {
      await call('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      });
    },
  };
}
