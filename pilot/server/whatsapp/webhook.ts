/// <reference types="node" />
// Meta's webhook for the WhatsApp channel: subscription check (GET) and signed message
// deliveries (POST). Each new message is recorded with its job before Meta gets its 200, so a
// crash never loses one; the worker (ingest.ts) does the rest.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { senderIdentity, type BotStore, type WaMessage, type WhatsAppSender } from './store';

export const WEBHOOK_PATH = '/api/v1/whatsapp/webhook';
/** Meta's largest webhook payload. */
const MAX_BODY_BYTES = 3 * 1024 * 1024;

export interface WhatsAppWebhookOptions {
  /** The verify token entered in Meta's webhook settings. */
  verifyToken: string;
  /** The Meta app secret that signs every delivery; server-side only. */
  appSecret: string;
  bot: BotStore;
  /** When set, messages to any other business number are ignored. */
  phoneNumberId?: string;
  /** Called after new messages were recorded, so a worker can start on them. */
  onRecorded?: () => void;
}

/** Equal strings, in time that depends on neither their contents nor their lengths. */
const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** True when `header` is `sha256=<hex>` of the HMAC-SHA256 of the exact body bytes. */
export function signatureMatches(body: Uint8Array, header: unknown, appSecret: string) {
  const match = typeof header === 'string' ? /^sha256=([0-9a-f]{64})$/i.exec(header.trim()) : null;
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(body).digest();
  return timingSafeEqual(Buffer.from(match[1], 'hex'), expected);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : []);

/**
 * Every inbound message in a delivery with its sender. Status updates for sent messages
 * (`statuses[]`) and messages without a usable sender are left out.
 */
export function extractMessages(payload: unknown, phoneNumberId?: string) {
  const found: { sender: WhatsAppSender; message: WaMessage }[] = [];
  if (!isObject(payload) || payload.object !== 'whatsapp_business_account') return found;
  for (const entry of list(payload.entry))
    for (const change of list(entry.changes)) {
      const value = change.value;
      if (change.field !== 'messages' || !isObject(value)) continue;
      const metadata = isObject(value.metadata) ? value.metadata : {};
      if (phoneNumberId && metadata.phone_number_id !== phoneNumberId) continue;
      const contacts = list(value.contacts);
      for (const message of list(value.messages)) {
        if (typeof message.id !== 'string' || !message.id || message.id.length > 512) continue;
        const from = typeof message.from === 'string' ? message.from : undefined;
        const fromUserId =
          typeof message.from_user_id === 'string' ? message.from_user_id : undefined;
        // The contact for this message, or the only one in the delivery.
        const contact =
          contacts.find(
            (c) => (fromUserId && c.user_id === fromUserId) || (from && c.wa_id === from),
          ) ?? (contacts.length === 1 ? contacts[0] : undefined);
        const sender = senderIdentity({
          bsuid: fromUserId ?? (typeof contact?.user_id === 'string' ? contact.user_id : undefined),
          waId: from ?? (typeof contact?.wa_id === 'string' ? contact.wa_id : undefined),
        });
        if (sender) found.push({ sender, message: message as WaMessage });
      }
    }
  return found;
}

function answer(res: ServerResponse, status: number, body?: string, type = 'application/json') {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (body === undefined) return void res.writeHead(status).end();
  res.writeHead(status, { 'content-type': type }).end(body);
}
const refuse = (res: ServerResponse, status: number, code: string, message: string) =>
  answer(res, status, JSON.stringify({ error: { code, message, retryable: false } }));

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

export function createWhatsAppWebhook(
  options: WhatsAppWebhookOptions,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
) {
  return async function webhook(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method === 'GET') {
      const token = url.searchParams.get('hub.verify_token') ?? '';
      const challenge = url.searchParams.get('hub.challenge') ?? '';
      if (
        url.searchParams.get('hub.mode') !== 'subscribe' ||
        !sameSecret(token, options.verifyToken) ||
        !challenge ||
        challenge.length > 256
      )
        return refuse(res, 403, 'FORBIDDEN', 'Verification failed.');
      return answer(res, 200, challenge, 'text/plain; charset=utf-8');
    }
    if (req.method !== 'POST') return refuse(res, 404, 'NOT_FOUND', 'No such endpoint.');

    const body = await readBody(req);
    if (!body) return refuse(res, 413, 'LIMIT_EXCEEDED', 'Request body is too large.');
    // The signature covers the raw bytes; nothing is parsed or stored before it is checked.
    const signature = req.headers['x-hub-signature-256'];
    if (signature === undefined) return refuse(res, 401, 'UNAUTHENTICATED', 'Missing signature.');
    if (!signatureMatches(body, signature, options.appSecret))
      return refuse(res, 403, 'FORBIDDEN', 'Signature does not match.');
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return refuse(res, 400, 'INVALID_INPUT', 'Body must be JSON.');
    }

    const receivedAt = nowSeconds();
    let recorded = 0;
    for (const { sender, message } of extractMessages(payload, options.phoneNumberId)) {
      const wamid = message.id;
      if (
        await options.bot.recordInbound(sender, {
          wamid,
          senderId: sender.userId,
          ownerKey: sender.ownerKey,
          receivedAt,
          message,
        })
      )
        recorded++;
    }
    answer(res, 200);
    if (recorded) options.onRecorded?.();
  };
}
