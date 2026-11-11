/// <reference types="node" />
// The few WhatsApp Cloud API (Graph API) calls the channel makes: reading inbound media,
// uploading media to send back, and text, media and interactive messages.

/** Where a reply goes: the BSUID when known (Meta accepts it since July 2026), else the number. */
/** A BSUID reply may carry the phone number too, for the fallback in `sendMessage`. */
export type WhatsAppAddress = { bsuid: string; waId?: string } | { waId: string };

export interface MediaInfo {
  url: string;
  mimeType?: string;
  sha256?: string;
  fileSize?: number;
}

export interface GraphClient {
  /** A fresh download URL for a media ID; URLs expire after five minutes. */
  getMediaUrl(mediaId: string): Promise<MediaInfo>;
  /** The file at a media URL, read with the access token; refused beyond `maxBytes`. */
  download(url: string, maxBytes: number): Promise<Uint8Array>;
  sendText(to: WhatsAppAddress, text: string): Promise<void>;
  /** Uploads a file for sending (`POST /{phone-number-id}/media`); returns its media ID. */
  uploadMedia(bytes: Uint8Array, mimeType: string, filename: string): Promise<string>;
  /** Sends uploaded media as a photo or a document, with an optional caption. */
  sendMedia(to: WhatsAppAddress, media: OutgoingMedia): Promise<void>;
  /** Sends an interactive message (`list`, `button` or `cta_url`) as Meta defines it. */
  sendInteractive(to: WhatsAppAddress, interactive: Record<string, unknown>): Promise<void>;
}

export interface OutgoingMedia {
  type: 'image' | 'document';
  mediaId: string;
  caption?: string;
  /** Shown for documents. */
  filename?: string;
}

/** A Graph API answer other than success; `status` 404 on a media URL means it expired. */
export class GraphError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Meta's reason (code, subcode, message, details), for the log only. */
    readonly detail?: string,
    /** Meta's error code, when it sent one. */
    readonly code?: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

/** The file is larger than the caller accepts; nothing beyond the limit was kept. */
export class MediaTooLargeError extends Error {
  constructor() {
    super('The media file is larger than allowed.');
    this.name = 'MediaTooLargeError';
  }
}

/** Graph API version used unless configured; current when this was written (November 2026). */
export const GRAPH_API_VERSION = 'v27.0';

export interface GraphClientOptions {
  /** System-user access token; server-side only. */
  accessToken: string;
  /** The business phone number ID replies are sent from. */
  phoneNumberId: string;
  /** `https://graph.facebook.com` by default; tests point it at a stand-in. */
  baseUrl?: string;
  version?: string;
  fetch?: typeof fetch;
}

/** Meta's "recipient phone number not in allowed list" (test numbers). */
const RECIPIENT_NOT_ALLOWED = 131030;

export function createGraphClient(options: GraphClientOptions): GraphClient {
  const fetchImpl = options.fetch ?? fetch;
  const api = `${(options.baseUrl ?? 'https://graph.facebook.com').replace(/\/$/, '')}/${
    options.version ?? GRAPH_API_VERSION
  }`;
  const phone = `${api}/${encodeURIComponent(options.phoneNumberId)}`;
  const auth = { authorization: `Bearer ${options.accessToken}` };
  const failed = async (res: Response, what: string) => {
    // Meta's error object says why (code, message, details); it never echoes the token.
    const body = (await res.text().catch(() => '')).slice(0, 2000);
    let reason = '';
    let code: number | undefined;
    try {
      const error = (JSON.parse(body) as { error?: Record<string, unknown> }).error ?? {};
      const details = (error.error_data as { details?: unknown } | undefined)?.details;
      if (typeof error.code === 'number') code = error.code;
      reason = [error.code, error.error_subcode, error.message, details]
        .filter((part) => part !== undefined && part !== '')
        .join(' / ');
    } catch {
      // Not JSON: keep only the status.
    }
    return new GraphError(
      res.status,
      `${what} failed with HTTP ${res.status}.`,
      reason || undefined,
      code,
    );
  };

  return {
    async getMediaUrl(mediaId) {
      const res = await fetchImpl(`${api}/${encodeURIComponent(mediaId)}`, { headers: auth });
      if (!res.ok) throw await failed(res, 'Media lookup');
      const body = (await res.json()) as Record<string, unknown>;
      if (typeof body.url !== 'string') throw new GraphError(502, 'Media lookup gave no URL.');
      return {
        url: body.url,
        ...(typeof body.mime_type === 'string' ? { mimeType: body.mime_type } : {}),
        ...(typeof body.sha256 === 'string' ? { sha256: body.sha256 } : {}),
        ...(body.file_size !== undefined ? { fileSize: Number(body.file_size) } : {}),
      };
    },

    async download(url, maxBytes) {
      const res = await fetchImpl(url, { headers: auth });
      if (!res.ok) throw await failed(res, 'Media download');
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
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new MediaTooLargeError();
        }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const part of parts) {
        bytes.set(part, at);
        at += part.length;
      }
      return bytes;
    },

    sendText(to, text) {
      return sendMessage(to, { type: 'text', text: { body: text, preview_url: false } });
    },

    async uploadMedia(bytes, mimeType, filename) {
      const form = new FormData();
      form.set('messaging_product', 'whatsapp');
      form.set('type', mimeType);
      form.set('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
      const res = await fetchImpl(`${phone}/media`, { method: 'POST', headers: auth, body: form });
      if (!res.ok) throw await failed(res, 'Uploading media');
      const body = (await res.json()) as Record<string, unknown>;
      if (typeof body.id !== 'string') throw new GraphError(502, 'Media upload gave no ID.');
      return body.id;
    },

    sendMedia(to, media) {
      const content =
        media.type === 'document'
          ? {
              id: media.mediaId,
              ...(media.caption ? { caption: media.caption } : {}),
              ...(media.filename ? { filename: media.filename } : {}),
            }
          : { id: media.mediaId, ...(media.caption ? { caption: media.caption } : {}) };
      return sendMessage(to, { type: media.type, [media.type]: content });
    },

    sendInteractive(to, interactive) {
      return sendMessage(to, { type: 'interactive', interactive });
    },
  };

  async function sendMessage(to: WhatsAppAddress, message: Record<string, unknown>) {
    const post = (address: Record<string, string>) =>
      fetchImpl(`${phone}/messages`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...address,
          ...message,
        }),
      });
    // Meta reads `recipient` as a BSUID and `to` as a phone number.
    let res = await post('bsuid' in to ? { recipient: to.bsuid } : { to: to.waId });
    if (!res.ok && 'bsuid' in to && to.waId) {
      const error = await failed(res, 'Sending a message');
      // A test number's allowed list (131030) matches phone numbers only, so a BSUID is
      // refused there even for an allowed phone: send the same message once to the number.
      if (error.code !== RECIPIENT_NOT_ALLOWED) throw error;
      res = await post({ to: to.waId });
    }
    if (!res.ok) throw await failed(res, 'Sending a message');
    await res.body?.cancel().catch(() => undefined);
  }
}
