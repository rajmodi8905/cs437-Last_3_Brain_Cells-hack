/// <reference types="node" />
// One-time links the Telegram bot sends (docs/pilot/telegram.md). A login link
// (`/api/v1/telegram/link/<token>`) links the Telegram user to the IITGN account signed in on the
// page; an app link (`/api/v1/telegram/open/<token>`) opens that linked account in the app. Both
// use WhatsApp's token format (32 random bytes in the path, kept only as their SHA-256, used once,
// valid for 10 minutes), and their pages, like WhatsApp's, run no scripts and load nothing.
import { createHash, randomBytes } from 'node:crypto';
import { LINK_SECONDS, hashLinkToken } from '../whatsapp/links';
import type { TelegramAccount, TelegramLink, TelegramStateStore } from './store';

export const TELEGRAM_LINK_PREFIX = '/api/v1/telegram/link/';
export const TELEGRAM_OPEN_PREFIX = '/api/v1/telegram/open/';
/** The only places Google sign-in may return to: a login link's own page. */
export const TELEGRAM_LINK_RETURN = /^\/api\/v1\/telegram\/link\/([A-Za-z0-9_-]{43})$/;

/** How a Telegram user is named on the link page: the @username, else the first name. */
export function telegramName(user: { username?: string; firstName?: string }) {
  if (user.username) return `Telegram @${user.username}`;
  const first = user.firstName?.replace(/\s+/g, ' ').trim().slice(0, 64);
  return first ? `Telegram account ${first}` : 'your Telegram account';
}

/** An email shown in the chat: the first and last letter of the name, and the domain. */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  const name = Array.from(email.slice(0, at));
  const shown = name.length <= 2 ? `${name[0]}•••` : `${name[0]}•••${name.at(-1)}`;
  return `${shown}${email.slice(at)}`;
}

/** Stores a new link and returns its URL (`prefix` on the pilot origin, then the token). */
async function storeLink(
  state: TelegramStateStore,
  link: Omit<TelegramLink, 'tokenHash' | 'createdAt' | 'expiresAt'>,
  origin: string,
  prefix: string,
  now: number,
) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashLinkToken(token);
  await state.createLink({ ...link, tokenHash, createdAt: now, expiresAt: now + LINK_SECONDS });
  return { url: `${origin.replace(/\/$/, '')}${prefix}${token}`, tokenHash };
}

/** A login link for a Telegram user who has not linked an account yet. */
export const createLoginLink = (
  state: TelegramStateStore,
  user: { userId: string; ownerKey: string; name: string },
  origin: string,
  now: number,
) =>
  storeLink(
    state,
    { purpose: 'login', userId: user.userId, ownerKey: user.ownerKey, label: user.name },
    origin,
    TELEGRAM_LINK_PREFIX,
    now,
  );

/** An app link that opens the user's linked account. */
export const createOpenLink = async (
  state: TelegramStateStore,
  account: TelegramAccount,
  origin: string,
  now: number,
) =>
  (
    await storeLink(
      state,
      {
        purpose: 'open',
        userId: account.userId,
        ownerKey: account.ownerKey,
        label: account.email,
      },
      origin,
      TELEGRAM_OPEN_PREFIX,
      now,
    )
  ).url;

const STYLE = `body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1b1d21}
main{max-width:30rem;margin:10vh auto;padding:0 16px}
h1{font-size:1.35rem;margin:0 0 .5rem}
p,ul{margin:0 0 1rem}
li{margin:0 0 .35rem}
a{color:#1f5fbf}
label{display:block;margin:0 0 1rem}
input{display:block;box-sizing:border-box;width:100%;font:inherit;margin:.35rem 0 0;padding:.55rem .65rem;border:1px solid #9aa1ab;border-radius:.4rem;background:#fff;color:#1b1d21}
button{font:inherit;padding:.65rem 1.2rem;border:0;border-radius:.5rem;background:#1f5fbf;color:#fff;cursor:pointer}
.note{font-size:.9rem;color:#4a515c}
@media (prefers-color-scheme:dark){body{background:#15171a;color:#e8eaed}a{color:#8ab4ff}input{background:#1f2226;color:#e8eaed;border-color:#5f6670}button{background:#5b9bff;color:#0b1220}.note{color:#b4bac3}}`;
const STYLE_HASH = createHash('sha256').update(STYLE).digest('base64');

/**
 * Headers for every Telegram link page: no scripts, nothing external, no framing, forms only to
 * this site. `same-origin` referrers, as on WhatsApp's pages, so the form's POST carries the real
 * `Origin` that the server checks.
 */
export const TELEGRAM_PAGE_HEADERS = {
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

const CONTINUE = `<form method="post"><button type="submit">Continue</button></form>`;

/** What linking means, shown before the student agrees by pressing Continue. */
const consent = (privacyUrl: string | undefined) =>
  `<ul>` +
  `<li>Photos, PDFs, notes and links you send or forward to the bot are saved in this account's AnyRecall cloud library, with the searches you type there.</li>` +
  `<li>Our server stores and processes your files to make them searchable, and sees your searches.</li>` +
  `<li>Telegram keeps bot chats on its own servers. Chats with bots are not end-to-end encrypted.</li>` +
  `<li>Whoever has this Telegram account can open your cloud library from the bot's one-time links (each works once, for 10 minutes).</li>` +
  `<li>You must be 18 or older. /logout unlinks the chat; /delete erases what you saved through it.</li>` +
  `</ul>` +
  (privacyUrl
    ? `<p class="note">Privacy: <a href="${escapeHtml(privacyUrl)}">${escapeHtml(privacyUrl)}</a></p>`
    : '');

/** Asks before linking; the form posts to this same path. */
export const linkConfirmPage = (name: string, email: string, privacyUrl?: string) =>
  page(
    'Link Telegram',
    `<h1>Link Telegram to AnyRecall</h1>` +
      `<p>Link <strong>${escapeHtml(name)}</strong> to <strong>${escapeHtml(email)}</strong>?</p>` +
      consent(privacyUrl) +
      CONTINUE,
  );

/** After linking. */
export const linkedPage = (name: string, email: string) =>
  page(
    'Telegram linked',
    `<h1>Telegram is linked</h1>` +
      `<p><strong>${escapeHtml(name)}</strong> is now linked to <strong>${escapeHtml(email)}</strong>.</p>` +
      `<p>Go back to Telegram: forward or send files to save them, and type anything to search.</p>`,
  );

/** The Telegram user is linked to another account already. */
export const linkedElsewherePage = () =>
  page(
    'Already linked',
    `<h1>This Telegram account is already linked</h1>` +
      `<p>It is linked to another AnyRecall account. Send /logout to the bot first, then /login again.</p>`,
  );

/**
 * Development sign-in on a login link, for a local trial only (the server has a development key
 * and no Google client): the typed email goes through the same identity checks as Google's.
 */
export const devSignInPage = (name: string, problem?: string) =>
  page(
    'Sign in to link Telegram',
    `<h1>Sign in to link ${escapeHtml(name)}</h1>` +
      `<p class="note">This is a local trial, so sign-in is the development one. On the pilot this is your IITGN Google sign-in.</p>` +
      (problem ? `<p><strong>${escapeHtml(problem)}</strong></p>` : '') +
      `<form method="post"><input type="hidden" name="intent" value="signin">` +
      `<label>IITGN email<input type="email" name="email" required autocomplete="email"></label>` +
      `<button type="submit">Sign in</button></form>`,
  );

/** The server has neither Google sign-in nor a development key. */
export const signInUnavailablePage = () =>
  page(
    'Sign-in unavailable',
    `<h1>Sign-in isn't available here</h1><p>This server cannot sign anyone in, so it cannot link Telegram.</p>`,
  );

/** Asks before opening the app as the linked account. */
export const openConfirmPage = (email: string) =>
  page(
    'Open AnyRecall',
    `<h1>Open your AnyRecall library</h1>` +
      `<p>Sign in to AnyRecall as <strong>${escapeHtml(email)}</strong> on this browser.</p>` +
      `<p>Your device's own library is not uploaded unless you choose to include it.</p>` +
      CONTINUE,
  );

/** Expired, used or unknown links all look the same. */
export const telegramLinkErrorPage = (purpose: TelegramLink['purpose']) =>
  page(
    'Link not valid',
    `<h1>This link doesn't work any more</h1>` +
      `<p>Links work once, for 10 minutes. Send ${purpose === 'login' ? '/login' : '/open'} to the AnyRecall Telegram bot for a new one.</p>`,
  );
