import { describe, expect, it } from 'vitest';
import type { SignInCode } from '../../src/application/ports/ICodeSignIn.js';
import { GoogleDrive, SIGN_IN_KEY } from '../../src/infrastructure/cloud/GoogleDrive.js';
import type { StorageLike } from '../../src/infrastructure/storage/LocalStorageSettingsStore.js';

type Answer = Record<string, unknown>;

/** The device's small store, in memory. */
class HeldStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/**
 * Google, as a browser that cannot open its window sees it: a code to hand
 * out, a token endpoint answering in turn, and the drive's folder.
 */
function google(options: {
  readonly code?: Answer;
  readonly tokens?: readonly Answer[];
  readonly byCode?: boolean;
  readonly windowClient?: string;
  readonly windowSignIns?: string[];
}) {
  let now = 1_000_000;
  const waits: number[] = [];
  const forms: URLSearchParams[] = [];
  const formTypes: string[] = [];
  const bearers: string[] = [];
  const tokens = [...(options.tokens ?? [])];
  const storage = new HeldStorage();
  const json = (value: unknown): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
  const fetch = (url: string, init: RequestInit = {}): Promise<Response> => {
    if (url.startsWith('https://oauth2.googleapis.com/')) {
      forms.push(new URLSearchParams(typeof init.body === 'string' ? init.body : ''));
      formTypes.push((init.headers as Record<string, string> | undefined)?.['Content-Type'] ?? '');
      if (url.endsWith('/device/code')) {
        return json(
          options.code ?? {
            device_code: 'the-device',
            user_code: 'ABCD-EFGH',
            verification_url: 'https://www.google.com/device',
            expires_in: 1800,
            interval: 5,
          },
        );
      }
      return json(tokens.shift() ?? { error: 'authorization_pending' });
    }
    bearers.push((init.headers as Record<string, string> | undefined)?.['Authorization'] ?? '');
    return json({ files: [{ id: 'folder', name: 'Sight Reading Practice' }] });
  };
  const drive = new GoogleDrive({
    clientId: options.windowClient ?? 'the-window-client',
    identity: () => {
      options.windowSignIns?.push('window');
      return Promise.reject(new Error('this browser opens no Google window'));
    },
    fetch,
    now: () => now,
    ...(options.byCode === false
      ? {}
      : {
          byCode: {
            clientId: 'the-code-client',
            clientSecret: 'the-code-secret',
            storage,
            wait: (ms: number) => {
              waits.push(ms);
              now += ms;
              return Promise.resolve();
            },
          },
        }),
  });
  return {
    drive,
    storage,
    waits,
    forms,
    formTypes,
    bearers,
    later: (ms: number) => {
      now += ms;
    },
  };
}

describe('signing in to the drive by a code', () => {
  it('asks for a code for its own files only, and shows it', async () => {
    const shown: SignInCode[] = [];
    const { drive, forms, formTypes } = google({
      tokens: [{ access_token: 'first', refresh_token: 'the-key', expires_in: 3599 }],
    });

    await drive.signInWithCode((code) => shown.push(code));

    expect(shown).toEqual([{ code: 'ABCD-EFGH', url: 'https://www.google.com/device' }]);
    expect(forms[0]?.get('client_id')).toBe('the-code-client');
    expect(forms[0]?.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    // A form Google reads, and one a browser sends without asking first.
    expect(formTypes).toEqual(['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded']);
  });

  it('says so when Google gives no code', async () => {
    const { drive } = google({ code: { error: 'invalid_scope', error_description: 'Not for this kind of client.' } });

    await expect(drive.signInWithCode(() => undefined)).rejects.toThrow('Not for this kind of client.');
  });

  it('reaches the drive by the key where the build has no window client at all', async () => {
    const { drive, storage, bearers } = google({
      windowClient: '',
      tokens: [{ access_token: 'renewed', expires_in: 3599 }],
    });
    storage.setItem(SIGN_IN_KEY, 'the-key');

    await drive.connect();

    expect(bearers).toEqual(['Bearer renewed']);
  });

  it('waits until the code is entered, slowing down when Google says to', async () => {
    const { drive, waits, forms } = google({
      tokens: [
        { error: 'authorization_pending' },
        { error: 'slow_down' },
        { access_token: 'first', refresh_token: 'the-key', expires_in: 3599 },
      ],
    });

    await drive.signInWithCode(() => undefined);

    expect(waits).toEqual([5000, 5000, 10_000]);
    const asked = forms.slice(1);
    expect(asked.map((form) => form.get('grant_type'))).toEqual([
      'urn:ietf:params:oauth:grant-type:device_code',
      'urn:ietf:params:oauth:grant-type:device_code',
      'urn:ietf:params:oauth:grant-type:device_code',
    ]);
    expect(asked[0]?.get('device_code')).toBe('the-device');
    expect(asked[0]?.get('client_secret')).toBe('the-code-secret');
  });

  it('reaches the drive with the token it was given, without opening a window', async () => {
    const windowSignIns: string[] = [];
    const { drive, bearers } = google({
      tokens: [{ access_token: 'first', refresh_token: 'the-key', expires_in: 3599 }],
      windowSignIns,
    });

    await drive.signInWithCode(() => undefined);
    await drive.connect();

    expect(windowSignIns).toEqual([]);
    expect(bearers).toEqual(['Bearer first']);
  });

  it('stays signed in past the hour, renewing the token with the key it keeps', async () => {
    // What lets a sync nobody pressed for go on: the window's token alone
    // runs out after an hour and only a press may open the window again.
    const { drive, storage, forms, bearers, later } = google({
      tokens: [
        { access_token: 'first', refresh_token: 'the-key', expires_in: 3599 },
        { access_token: 'renewed', expires_in: 3599 },
      ],
    });
    await drive.signInWithCode(() => undefined);
    expect(storage.getItem(SIGN_IN_KEY)).toBe('the-key');

    later(2 * 60 * 60 * 1000);
    expect(drive.signedIn).toBe(true);
    await drive.connect();

    const renewal = forms[forms.length - 1];
    expect(renewal?.get('grant_type')).toBe('refresh_token');
    expect(renewal?.get('refresh_token')).toBe('the-key');
    expect(bearers).toEqual(['Bearer renewed']);
  });

  it('asks for a new code once the key has been taken back', async () => {
    const { drive, storage } = google({ tokens: [{ error: 'invalid_grant' }] });
    storage.setItem(SIGN_IN_KEY, 'a-key-taken-back');

    await expect(drive.connect()).rejects.toThrow('Sign in with a code again');
    expect(storage.getItem(SIGN_IN_KEY)).toBeNull();
    expect(drive.signedIn).toBe(false);
  });

  it('says why a renewal failed, and keeps the key for the next try', async () => {
    const { drive, storage } = google({
      tokens: [{ error: 'invalid_client', error_description: 'The OAuth client was deleted.' }],
    });
    storage.setItem(SIGN_IN_KEY, 'the-key');

    await expect(drive.connect()).rejects.toThrow('The OAuth client was deleted.');
    expect(storage.getItem(SIGN_IN_KEY)).toBe('the-key');
  });

  it('says so when the sign-in is refused on the other device', async () => {
    const { drive, storage } = google({ tokens: [{ error: 'access_denied' }] });

    await expect(drive.signInWithCode(() => undefined)).rejects.toThrow('refused on the other device');
    expect(storage.getItem(SIGN_IN_KEY)).toBeNull();
  });

  it('stops waiting when the code runs out, asking every five seconds where Google does not say', async () => {
    const { drive, waits } = google({
      code: { device_code: 'd', user_code: 'C', verification_url: 'u', expires_in: 12 },
    });

    await expect(drive.signInWithCode(() => undefined)).rejects.toThrow('ran out');
    expect(waits).toEqual([5000, 5000, 5000]);
  });

  it('is offered only where the build has the client for it', async () => {
    const { drive } = google({ byCode: false });

    expect(drive.available).toBe(false);
    expect(google({}).drive.available).toBe(true);
    await expect(drive.signInWithCode(() => undefined)).rejects.toThrow('not set up');
  });
});
