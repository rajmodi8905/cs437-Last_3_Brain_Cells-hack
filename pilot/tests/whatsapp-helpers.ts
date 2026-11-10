/// <reference types="node" />
// WhatsApp test fixtures: a stand-in for Meta's Graph API on a local port, webhook deliveries
// shaped like Meta's documented examples, and their signatures.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const APP_SECRET = 'test-app-secret';
export const VERIFY_TOKEN = 'test-verify-token';
export const ACCESS_TOKEN = 'test-access-token';
export const PHONE_NUMBER_ID = '106540352242922';

export const sign = (body: string | Uint8Array, secret = APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** The form WhatsApp webhooks use for `sha256`. */
export const sha256Base64 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('base64');

interface StoredMedia {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Meta's Graph API as the channel uses it: media lookup, media download (bearer token, URLs
 * that can expire) and sending messages. Failures can be injected per call.
 */
export async function startFakeGraph() {
  const media = new Map<string, StoredMedia>();
  const urls = new Map<string, { mediaId: string; expired: boolean }>();
  const state = {
    sent: [] as Record<string, unknown>[],
    lookups: [] as string[],
    downloads: [] as string[],
    /** Downloads answered with this status before any succeeds. */
    failDownloads: 0,
    failStatus: 500,
    /** Downloads answered with damaged bytes. */
    corruptDownloads: 0,
    /** Every URL issued by a lookup is already expired. */
    expireLookups: false,
    failSends: 0,
  };
  let base = '';
  const issue = (mediaId: string, expired = false) => {
    const token = randomBytes(12).toString('hex');
    urls.set(token, { mediaId, expired });
    return `${base}/download/${token}`;
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://graph.local');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.headers.authorization !== `Bearer ${ACCESS_TOKEN}`)
      return json(401, { error: { message: 'Invalid OAuth access token', code: 190 } });

    let match: RegExpExecArray | null;
    if ((match = /^\/download\/([0-9a-f]+)$/.exec(url.pathname)) && req.method === 'GET') {
      state.downloads.push(match[1]);
      const issued = urls.get(match[1]);
      const found = issued && media.get(issued.mediaId);
      if (!issued || issued.expired || !found) return json(404, { error: { code: 100 } });
      if (state.failDownloads > 0) {
        state.failDownloads--;
        return json(state.failStatus, { error: { code: 131000 } });
      }
      let bytes = found.bytes;
      if (state.corruptDownloads > 0) {
        state.corruptDownloads--;
        bytes = bytes.slice();
        bytes[0] ^= 0xff;
      }
      res.writeHead(200, {
        'content-type': found.mimeType,
        'content-length': String(bytes.length),
      });
      return res.end(bytes);
    }
    if ((match = /^\/v[\d.]+\/([^/]+)\/messages$/.exec(url.pathname)) && req.method === 'POST') {
      if (match[1] !== PHONE_NUMBER_ID) return json(400, { error: { code: 100 } });
      if (state.failSends > 0) {
        state.failSends--;
        return json(500, { error: { code: 131000 } });
      }
      state.sent.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return json(200, {
        messaging_product: 'whatsapp',
        messages: [{ id: `wamid.out${state.sent.length}` }],
      });
    }
    if ((match = /^\/v[\d.]+\/([^/]+)$/.exec(url.pathname)) && req.method === 'GET') {
      const id = decodeURIComponent(match[1]);
      state.lookups.push(id);
      const found = media.get(id);
      if (!found) return json(404, { error: { code: 100 } });
      return json(200, {
        messaging_product: 'whatsapp',
        url: issue(id, state.expireLookups),
        mime_type: found.mimeType,
        // Media lookups give the hash as hex.
        sha256: sha256Hex(found.bytes),
        file_size: String(found.bytes.length),
        id,
      });
    }
    json(404, { error: { code: 100 } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    base,
    state,
    /** Makes a media file available under `id`; returns a fresh download URL for webhooks. */
    addMedia(id: string, bytes: Uint8Array, mimeType: string) {
      media.set(id, { bytes, mimeType });
      return issue(id);
    },
    /** A download URL that has already expired, as after five minutes. */
    expiredUrl: (id: string) => issue(id, true),
    /** Texts sent to a recipient (BSUID or number). */
    textsTo: (recipient: string) =>
      state.sent
        .filter((sent) => sent.recipient === recipient || sent.to === recipient)
        .map((sent) => (sent.text as { body: string }).body),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const BSUID_A = 'IN.13491208655302741918';
export const BSUID_B = 'IN.98765432109876543210';
export const PHONE_A = '919876543210';
export const PHONE_B = '919812345678';
let counter = 0;
/** A message ID in Meta's format. */
export const newWamid = () =>
  `wamid.${Buffer.from(`HBgMOTE5ODc2NTQzMjEwFQIAEhgU${++counter}${randomBytes(6).toString('hex')}`).toString('base64')}`;

export interface From {
  bsuid?: string;
  phone?: string;
  name?: string;
}
const A: From = { bsuid: BSUID_A, phone: PHONE_A, name: 'Student A' };

/** One inbound message as it appears in `value.messages[]`; `over` adds or replaces fields. */
export function message(
  type: string,
  content: unknown,
  from: From = A,
  over: Record<string, unknown> = {},
) {
  return {
    ...(from.phone ? { from: from.phone } : {}),
    ...(from.bsuid ? { from_user_id: from.bsuid } : {}),
    id: newWamid(),
    timestamp: '1762300000',
    type,
    [type]: content,
    ...over,
  };
}

/** A webhook delivery (Meta's documented shape) carrying the given messages from one sender. */
export function delivery(messages: Record<string, unknown>[], from: From = A) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: PHONE_NUMBER_ID },
              contacts: [
                {
                  profile: { name: from.name ?? 'Student' },
                  ...(from.phone ? { wa_id: from.phone } : {}),
                  ...(from.bsuid ? { user_id: from.bsuid } : {}),
                },
              ],
              messages,
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

/** A delivery with only a status update for a message the bot sent. */
export const statusDelivery = () => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: PHONE_NUMBER_ID },
            statuses: [
              {
                id: 'wamid.out1',
                status: 'delivered',
                timestamp: '1762300005',
                recipient_id: PHONE_A,
                recipient_user_id: BSUID_A,
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
});

/** Bytes that look like a small JPEG. */
export const jpeg = (length = 5000, seed = 1) => {
  const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};
export const pdfBytes = (text = 'Guests need a pass. ') =>
  new TextEncoder().encode('%PDF-1.4\n' + text.repeat(200));
