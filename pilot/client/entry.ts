// Entry links. An INSIIT link only opens this site; it never signs anyone in. Credentials are
// never read from a URL: anything that looks like one is dropped from the address and history.
const CREDENTIAL_PARAMS = new Set([
  'token',
  'id_token',
  'idtoken',
  'access_token',
  'refresh_token',
  'code',
  'credential',
  'oobcode',
]);

const SIGN_IN_RESULTS = ['failed', 'cancelled', 'not-eligible'] as const;
export type SignInResult = (typeof SIGN_IN_RESULTS)[number];

export interface Entry {
  /** Set when the user arrived through the INSIIT link. */
  from?: 'insiit';
  /** Set when Google sign-in came back without a session. */
  signIn?: SignInResult;
  /**
   * Set when a WhatsApp link just opened a session (`signin=whatsapp`). The session is the
   * server's cookie; this only says the user chose to use Auto-sync, as returning from Google.
   */
  signedIn?: 'whatsapp';
  /** The address to show, without entry or credential parameters. */
  cleanUrl: string;
  strippedCredentials: boolean;
}

function clean(params: URLSearchParams) {
  let stripped = false;
  let from: Entry['from'];
  let signIn: Entry['signIn'];
  let signedIn: Entry['signedIn'];
  for (const key of [...params.keys()]) {
    const lower = key.toLowerCase();
    const value = params.get(key);
    if (CREDENTIAL_PARAMS.has(lower)) {
      stripped = true;
      params.delete(key);
    } else if (lower === 'from') {
      if (value === 'insiit') from = 'insiit';
      params.delete(key);
    } else if (lower === 'signin') {
      if (SIGN_IN_RESULTS.includes(value as SignInResult)) signIn = value as SignInResult;
      else if (value === 'whatsapp') signedIn = 'whatsapp';
      params.delete(key);
    }
  }
  const rest = params.toString();
  return { stripped, from, signIn, signedIn, rest: rest ? `?${rest}` : '' };
}

export function readEntry(href: string): Entry {
  const url = new URL(href);
  const query = clean(url.searchParams);
  const [route, hashQuery = ''] = url.hash.split('?');
  const inHash = clean(new URLSearchParams(hashQuery));
  const from = query.from ?? inHash.from;
  const signIn = query.signIn ?? inHash.signIn;
  const signedIn = query.signedIn ?? inHash.signedIn;
  return {
    ...(from ? { from } : {}),
    ...(signIn ? { signIn } : {}),
    ...(signedIn ? { signedIn } : {}),
    cleanUrl: `${url.origin}${url.pathname}${query.rest}${route}${inHash.rest}`,
    strippedCredentials: query.stripped || inHash.stripped,
  };
}

/** Reads the entry once on load and replaces the address without adding a history entry. */
export function applyEntry(location: Location = globalThis.location): Entry {
  const entry = readEntry(location.href);
  if (entry.cleanUrl !== location.href) history.replaceState(history.state, '', entry.cleanUrl);
  return entry;
}
