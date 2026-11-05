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

export interface Entry {
  /** Set when the user arrived through the INSIIT link. */
  from?: 'insiit';
  /** The address to show, without entry or credential parameters. */
  cleanUrl: string;
  strippedCredentials: boolean;
}

function clean(params: URLSearchParams) {
  let stripped = false;
  let from: Entry['from'];
  for (const key of [...params.keys()]) {
    const lower = key.toLowerCase();
    if (CREDENTIAL_PARAMS.has(lower)) {
      stripped = true;
      params.delete(key);
    } else if (lower === 'from') {
      if (params.get(key) === 'insiit') from = 'insiit';
      params.delete(key);
    }
  }
  const rest = params.toString();
  return { stripped, from, rest: rest ? `?${rest}` : '' };
}

export function readEntry(href: string): Entry {
  const url = new URL(href);
  const query = clean(url.searchParams);
  const [route, hashQuery = ''] = url.hash.split('?');
  const inHash = clean(new URLSearchParams(hashQuery));
  const from = query.from ?? inHash.from;
  return {
    ...(from ? { from } : {}),
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
