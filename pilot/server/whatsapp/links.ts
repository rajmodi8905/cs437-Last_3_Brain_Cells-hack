/// <reference types="node" />
// One-time links that open a WhatsApp vault in the app (W6). The token is 32 random bytes in
// the URL path (the app strips `token` from query strings), kept only as its SHA-256, used once
// and valid for 10 minutes. GET shows a confirmation page and uses nothing up, so link previews
// cannot spend it; its Continue button posts back to the same origin, which opens the session.
import { createHash, randomBytes } from 'node:crypto';
import type { BotStore, WhatsAppSender } from './store';

export const OPEN_PATH_PREFIX = '/api/v1/whatsapp/open/';
/** Ten minutes. */
export const LINK_SECONDS = 600;
/** 32 bytes in base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const hashLinkToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const isLinkToken = (token: string) => TOKEN.test(token);

/** The account name the app shows: the last four digits of the number, when it is known. */
export const maskedLabel = (sender: Pick<WhatsAppSender, 'waId'>) =>
  sender.waId && sender.waId.length >= 4
    ? `WhatsApp ••••${sender.waId.slice(-4)}`
    : 'your WhatsApp account';

/** Stores a new link for the sender's vault and returns its URL. */
export async function createOpenLink(
  bot: BotStore,
  sender: WhatsAppSender,
  origin: string,
  now: number,
) {
  return storeOpenLink(
    bot,
    { ownerKey: sender.ownerKey, label: maskedLabel(sender) },
    `${origin.replace(/\/$/, '')}${OPEN_PATH_PREFIX}`,
    now,
  );
}

/**
 * Stores a new one-time link for a vault, labelled with the account name the app will show, and
 * returns its URL: `base` (the channel's open path on the pilot origin) and the token. Shared with
 * the Telegram channel, whose links live in its own store and path.
 */
export async function storeOpenLink(
  bot: BotStore,
  vault: { ownerKey: string; label: string },
  base: string,
  now: number,
) {
  const token = randomBytes(32).toString('base64url');
  await bot.createLink({
    tokenHash: hashLinkToken(token),
    ownerKey: vault.ownerKey,
    label: vault.label,
    createdAt: now,
    expiresAt: now + LINK_SECONDS,
  });
  return `${base}${token}`;
}

const STYLE = `body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1b1d21}
main{max-width:26rem;margin:12vh auto;padding:0 16px}
h1{font-size:1.35rem;margin:0 0 .5rem}
p{margin:0 0 1rem}
button{font:inherit;padding:.65rem 1.2rem;border:0;border-radius:.5rem;background:#1f5fbf;color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#15171a;color:#e8eaed}button{background:#5b9bff;color:#0b1220}}`;
const STYLE_HASH = createHash('sha256').update(STYLE).digest('base64');

/**
 * Headers for both pages: nothing external, no scripts, no framing. The referrer policy is
 * `same-origin`, not `no-referrer`: with `no-referrer` browsers send `Origin: null` on the form's
 * POST, and the server needs the real origin to check it. Other sites still get no referrer.
 */
export const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const page = (title: string, body: string) =>
  new TextEncoder().encode(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>` +
      `<style>${STYLE}</style></head><body><main>${body}</main></body></html>`,
  );

/** Asks before opening the session; the form posts to this same path. */
export const confirmPage = (label: string, channel = 'WhatsApp') =>
  page(
    'Open Campus Recall',
    `<h1>Open your ${escapeHtml(channel)} library</h1>` +
      `<p>Sign in to Campus Recall as <strong>${escapeHtml(label)}</strong> on this browser.</p>` +
      `<p>Your device's own library is not uploaded unless you choose to include it.</p>` +
      `<form method="post"><button type="submit">Continue</button></form>`,
  );

/** Expired, used or unknown links all look the same; `again` says how to get a new one. */
export const linkErrorPage = (
  again = 'Send OPEN to the Campus Recall WhatsApp number for a new one.',
) =>
  page(
    'Link not valid',
    `<h1>This link doesn't work any more</h1>` +
      `<p>Links work once, for 10 minutes. ${escapeHtml(again)}</p>`,
  );
