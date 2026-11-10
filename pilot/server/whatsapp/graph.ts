/// <reference types="node" />
// The few WhatsApp Cloud API (Graph API) calls the channel makes. Later slices add
// interactive messages and sending media through the same client.

/** Where a reply goes: the BSUID when known (Meta accepts it since July 2026), else the number. */
export type WhatsAppAddress = { bsuid: string } | { waId: string };

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
}

/** A Graph API answer other than success; `status` 404 on a media URL means it expired. */
export class GraphError extends Error {
  constructor(
    readonly status: number,
    message: string,
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

export function createGraphClient(options: GraphClientOptions): GraphClient {
  const fetchImpl = options.fetch ?? fetch;
  const api = `${(options.baseUrl ?? 'https://graph.facebook.com').replace(/\/$/, '')}/${
    options.version ?? GRAPH_API_VERSION
  }`;
  const auth = { authorization: `Bearer ${options.accessToken}` };
  const failed = async (res: Response, what: string) => {
    await res.body?.cancel().catch(() => undefined);
    return new GraphError(res.status, `${what} failed with HTTP ${res.status}.`);
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

    async sendText(to, text) {
      const res = await fetchImpl(`${api}/${encodeURIComponent(options.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          // Meta reads `recipient` as a BSUID and `to` as a phone number.
          ...('bsuid' in to ? { recipient: to.bsuid } : { to: to.waId }),
          type: 'text',
          text: { body: text, preview_url: false },
        }),
      });
      if (!res.ok) throw await failed(res, 'Sending a message');
      await res.body?.cancel().catch(() => undefined);
    },
  };
}
