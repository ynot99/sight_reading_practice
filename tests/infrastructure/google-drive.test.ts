import { describe, expect, it } from 'vitest';
import {
  FOLDER_NAME,
  GoogleDrive,
  type GoogleIdentity,
  type TokenResponse,
} from '../../src/infrastructure/cloud/GoogleDrive.js';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Google, as far as the adapter can tell: a sign-in window and a drive. */
function google(options: {
  readonly folders?: readonly string[];
  readonly pages?: readonly (readonly { id: string; name: string }[])[];
  readonly signIn?: TokenResponse | 'closed';
  readonly status?: number;
}) {
  const calls: Call[] = [];
  const signIns: { clientId: string; scope: string }[] = [];
  let now = 1_000_000;
  const identity: GoogleIdentity = {
    initTokenClient: (config) => ({
      requestAccessToken: () => {
        signIns.push({ clientId: config.client_id, scope: config.scope });
        const answer = options.signIn ?? { access_token: `token-${String(signIns.length)}`, expires_in: 3600 };
        if (answer === 'closed') {
          config.error_callback?.({ type: 'popup_closed' });
          return;
        }
        config.callback(answer);
      },
    }),
  };
  const fetch = (url: string, init: RequestInit = {}): Promise<Response> => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    });
    if (options.status !== undefined) {
      return Promise.resolve(new Response('', { status: options.status }));
    }
    const json = (value: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
    if (url.includes("mimeType%3D%27application%2Fvnd.google-apps.folder")) {
      return json({ files: (options.folders ?? []).map((id) => ({ id, name: FOLDER_NAME })) });
    }
    if (url.includes('/drive/v3/files?fields=id%2Cname') || url.endsWith('/drive/v3/files?fields=id,name')) {
      return json({ id: 'made-folder', name: FOLDER_NAME });
    }
    if (url.includes('in+parents') || url.includes('in%20parents')) {
      const pages = options.pages ?? [[]];
      const at = url.includes('pageToken=') ? Number(new URL(url).searchParams.get('pageToken')) : 0;
      return json({
        files: pages[at] ?? [],
        ...(at + 1 < pages.length ? { nextPageToken: String(at + 1) } : {}),
      });
    }
    if (url.includes('alt=media')) {
      return Promise.resolve(new Response('<score/>', { status: 200 }));
    }
    return json({ id: 'written', name: 'x' });
  };
  const drive = new GoogleDrive({
    clientId: 'the-client',
    identity: () => Promise.resolve(identity),
    fetch,
    now: () => now,
  });
  return {
    drive,
    calls,
    signIns,
    later: (ms: number) => {
      now += ms;
    },
  };
}

describe('the trainer folder on Google Drive', () => {
  it('signs in for its own files only, and finds the folder it made before', async () => {
    const { drive, signIns, calls } = google({ folders: ['kept-folder'] });

    await drive.connect();

    expect(signIns).toEqual([
      { clientId: 'the-client', scope: 'https://www.googleapis.com/auth/drive.file' },
    ]);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(calls[0]?.headers['Authorization']).toBe('Bearer token-1');
  });

  it('makes the folder where there is none', async () => {
    const { drive, calls } = google({ folders: [] });

    await drive.connect();
    await drive.list();

    const made = calls.find((call) => call.method === 'POST');
    expect(JSON.parse(made?.body ?? '{}')).toEqual({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    });
    expect(calls[calls.length - 1]?.url).toContain('made-folder');
  });

  it('signs in once while the token lasts, and again once it has run out', async () => {
    const { drive, signIns, later } = google({ folders: ['f'] });

    await drive.connect();
    await drive.connect();
    expect(signIns).toHaveLength(1);

    later(60 * 60 * 1000);
    await drive.connect();
    expect(signIns).toHaveLength(2);
  });

  it('says so where the build was made without a client id', async () => {
    // The id comes from the build's environment, and a copy built without it
    // has no drive - which must be said rather than a Google window that
    // opens onto an error.
    let signedIn = 0;
    const drive = new GoogleDrive({
      clientId: '',
      identity: () => {
        signedIn += 1;
        return Promise.reject(new Error('never'));
      },
      fetch: () => Promise.reject(new Error('never')),
      now: () => 0,
    });

    await expect(drive.connect()).rejects.toThrow('not set up');
    expect(signedIn).toBe(0);
  });

  it('says so when the reader closes the Google window', async () => {
    const { drive } = google({ signIn: 'closed' });

    await expect(drive.connect()).rejects.toThrow('closed before signing in');
  });

  it('lists every page of the folder', async () => {
    const { drive } = google({
      folders: ['f'],
      pages: [[{ id: '1', name: 'a.json' }], [{ id: '2', name: 'b.musicxml' }]],
    });
    await drive.connect();

    const files = await drive.list();

    expect(files.map((file) => file.name)).toEqual(['a.json', 'b.musicxml']);
  });

  it('writes a new file into the folder, and over an old one in place', async () => {
    const { drive, calls } = google({ folders: ['f'] });
    await drive.connect();

    await drive.write('library.json', '{"a":1}', null);
    await drive.write('library.json', '{"a":2}', 'old-id');

    const [made, replaced] = calls.filter((call) => call.url.includes('/upload/'));
    expect(made?.method).toBe('POST');
    expect(made?.body).toContain('"parents":["f"]');
    expect(made?.body).toContain('{"a":1}');
    expect(replaced?.method).toBe('PATCH');
    expect(replaced?.url).toContain('/files/old-id?');
    expect(replaced?.body).toBe('{"a":2}');
  });

  it('asks to sign in again when Google says the token is no good', async () => {
    const refusing = google({ folders: ['f'], status: 401 });

    await expect(refusing.drive.connect()).rejects.toThrow('sign in again');
    // The token is let go, so the next press signs in afresh.
    await expect(refusing.drive.connect()).rejects.toThrow('sign in again');
    expect(refusing.signIns).toHaveLength(2);
  });
});
