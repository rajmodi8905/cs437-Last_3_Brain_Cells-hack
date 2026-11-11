/// <reference types="node" />
// Telegram's webhook (webhook mode): Telegram posts each update with the secret token given to
// `setWebhook` in `X-Telegram-Bot-Api-Secret-Token`. The header is checked in constant time before
// the body is read; a recorded update is answered 200 at once and the worker does the rest.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const TELEGRAM_WEBHOOK_PATH = '/api/v1/telegram/webhook';
/** Updates are small JSON documents; files are fetched separately. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface TelegramWebhookOptions {
  /** The `secret_token` given to `setWebhook`; server-side only. */
  secretToken: string;
  /** Records one update; true when it was new. Throwing answers 500, so Telegram retries. */
  intake: (update: unknown) => Promise<boolean>;
  /** Called after a new update was recorded, so a worker can start on it. */
  onRecorded?: () => void;
}

/** Equal strings, in time that depends on neither their contents nor their lengths. */
const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

function answer(res: ServerResponse, status: number, body?: unknown) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (body === undefined) return void res.writeHead(status).end();
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
const refuse = (res: ServerResponse, status: number, code: string, message: string) =>
  answer(res, status, { error: { code, message, retryable: false } });

async function readBody(req: IncomingMessage) {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) return undefined;
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

export function createTelegramWebhook(options: TelegramWebhookOptions) {
  return async function webhook(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return refuse(res, 404, 'NOT_FOUND', 'No such endpoint.');
    // Nothing is read, parsed or stored before the secret token matches.
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header === undefined) return refuse(res, 401, 'UNAUTHENTICATED', 'Missing secret token.');
    if (typeof header !== 'string' || !sameSecret(header, options.secretToken))
      return refuse(res, 403, 'FORBIDDEN', 'Secret token does not match.');
    const body = await readBody(req);
    if (!body) return refuse(res, 413, 'LIMIT_EXCEEDED', 'Request body is too large.');
    let update: unknown;
    try {
      update = JSON.parse(body.toString('utf8'));
    } catch {
      return refuse(res, 400, 'INVALID_INPUT', 'Body must be JSON.');
    }
    const recorded = await options.intake(update);
    answer(res, 200);
    if (recorded) options.onRecorded?.();
  };
}
