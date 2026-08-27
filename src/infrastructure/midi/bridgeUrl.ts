/** Minimal view of `window.location` so the rules below stay testable. */
export interface LocationLike {
  readonly protocol: string;
  readonly hostname: string;
  readonly host: string;
  readonly search: string;
}

const PRIVATE_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
];

/**
 * True for addresses that can only belong to the machine or the home network.
 *
 * The bridge is only ever reachable on a LAN, so this is what decides whether
 * to look for one at all. It also keeps the published GitHub Pages build from
 * pointlessly retrying a socket that can never exist there.
 */
export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_PATTERNS.some((pattern) => pattern.test(hostname));
}

/**
 * Where to look for the MIDI bridge, or `null` when there cannot be one.
 *
 * By default the bridge is the same server that served the page, which is the
 * normal setup: one command on the desktop serves both the app and the notes.
 * `?bridge=host:port` overrides that for anything unusual.
 */
export function resolveBridgeUrl(location: LocationLike): string | null {
  const override = new URLSearchParams(location.search).get('bridge');
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (override !== null && override.length > 0) {
    return override.startsWith('ws:') || override.startsWith('wss:')
      ? override
      : `${scheme}//${override}/midi`;
  }

  if (!isPrivateHost(location.hostname)) {
    return null;
  }

  return `${scheme}//${location.host}/midi`;
}
