import type { CloudFile, ICloudDrive } from '../../application/ports/ICloudDrive.js';
import type { ICodeSignIn, SignInCode } from '../../application/ports/ICodeSignIn.js';
import type { StorageLike } from '../storage/LocalStorageSettingsStore.js';

/** Only what this program made, or what the reader opened with it - never the rest of the drive. */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DEVICE_CODE = 'https://oauth2.googleapis.com/device/code';
const TOKEN = 'https://oauth2.googleapis.com/token';
/**
 * Where the key a sign-in by code hands back is kept, on this device only.
 *
 * Not among the stores a backup carries: it opens this device's way to the
 * drive, and a file taken to another device must not carry it there.
 */
export const SIGN_IN_KEY = 'sight-reading-practice/google-sign-in';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
export const FOLDER_NAME = 'Sight Reading Practice';
/** A token is let go this long before Google says it ends, so no call is made on its last breath. */
const EXPIRY_MARGIN_MS = 60_000;

/** What Google's sign-in hands back. */
export interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number | string;
  readonly error?: string;
  readonly error_description?: string;
}

/** As much of Google's sign-in library as this needs. */
export interface GoogleIdentity {
  initTokenClient(config: {
    readonly client_id: string;
    readonly scope: string;
    readonly callback: (response: TokenResponse) => void;
    readonly error_callback?: (error: { readonly type?: string; readonly message?: string }) => void;
  }): { requestAccessToken(options?: { readonly prompt?: string }): void };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** What Google's sign-in by code answers, at each step. */
interface CodeAnswer {
  readonly device_code?: string;
  readonly user_code?: string;
  readonly verification_url?: string;
  readonly expires_in?: number;
  readonly interval?: number;
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/**
 * The second client, the one that signs in by a code.
 *
 * Google gives this kind a secret, and says itself that a program on the
 * reader's device cannot keep one: it is in every built copy, as the id is.
 */
export interface CodeClient {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Where the key it hands back is kept; see `SIGN_IN_KEY`. */
  readonly storage: StorageLike | null;
  /** Waits between asking whether the code has been confirmed. */
  readonly wait: (ms: number) => Promise<void>;
}

export interface GoogleDriveOptions {
  readonly clientId: string;
  /** Loads Google's sign-in library; the page's own script tag by default. */
  readonly identity: () => Promise<GoogleIdentity>;
  readonly fetch: Fetch;
  /** Wall-clock milliseconds, for when a token runs out. */
  readonly now: () => number;
  /** Signing in by a code; a build without it has only Google's window. */
  readonly byCode?: CodeClient;
}

/**
 * Google's sign-in library, loaded once and only when asked for.
 *
 * Not in the page itself: a reader who never connects a drive should never
 * fetch anything from Google, and the trainer has to open with no network at
 * all.
 */
export function loadGoogleIdentity(doc: Document): () => Promise<GoogleIdentity> {
  let loading: Promise<GoogleIdentity> | null = null;
  const loaded = (): GoogleIdentity | undefined =>
    (doc.defaultView as { google?: { accounts?: { oauth2?: GoogleIdentity } } } | null)?.google
      ?.accounts?.oauth2;
  return () => {
    loading ??= new Promise<GoogleIdentity>((resolve, reject) => {
      const already = loaded();
      if (already !== undefined) {
        resolve(already);
        return;
      }
      const script = doc.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        const identity = loaded();
        if (identity === undefined) {
          reject(new Error('Google sign-in did not load.'));
          return;
        }
        resolve(identity);
      };
      script.onerror = () => {
        // Tried again next time: a device that was offline may not be now.
        loading = null;
        reject(new Error('Google could not be reached. Is this device online?'));
      };
      doc.head.append(script);
    });
    return loading;
  };
}

/**
 * The reader's Google Drive, through the one folder the trainer makes there.
 *
 * Signed in with Google's own window and a token that lasts about an hour,
 * kept in memory only. A press after it has run out signs in again, which Google does
 * without asking once the reader has agreed.
 *
 * Or signed in by a code, which leaves a key on the device: a token that has
 * run out is then renewed with it, without a window and without a press.
 */
export class GoogleDrive implements ICloudDrive, ICodeSignIn {
  private readonly options: GoogleDriveOptions;
  private identity: Promise<GoogleIdentity> | null = null;
  private token: { readonly value: string; readonly expiresAtMs: number } | null = null;
  private folderId: string | null = null;

  constructor(options: GoogleDriveOptions) {
    this.options = options;
  }

  /**
   * While the token lasts, or for as long as a key from a code is kept: after
   * the token alone, Google's window has to be opened again, by a press.
   */
  get signedIn(): boolean {
    return (this.token !== null && this.options.now() < this.token.expiresAtMs) || this.keptKey() !== null;
  }

  get available(): boolean {
    return (this.options.byCode?.clientId ?? '') !== '';
  }

  async signInWithCode(show: (code: SignInCode) => void): Promise<void> {
    const client = this.options.byCode;
    if (client === undefined || client.clientId === '') {
      throw new Error('Signing in by a code is not set up in this copy of the trainer.');
    }
    const asked = await this.askGoogle(DEVICE_CODE, { client_id: client.clientId, scope: SCOPE });
    const { device_code: device, user_code: code, verification_url: url, expires_in: lasts } = asked;
    if (device === undefined || code === undefined || url === undefined || lasts === undefined) {
      throw new Error(asked.error_description ?? 'Google gave no code.');
    }
    show({ code, url });
    // Five seconds where Google does not say: the standard's own default.
    let interval = (asked.interval ?? 5) * 1000;
    const until = this.options.now() + lasts * 1000;
    while (this.options.now() < until) {
      await client.wait(interval);
      const answer = await this.askGoogle(TOKEN, {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        device_code: device,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      if (answer.access_token !== undefined) {
        if (answer.refresh_token !== undefined) {
          this.keepKey(answer.refresh_token);
        }
        this.token = this.tokenFrom(answer.access_token, answer.expires_in);
        return;
      }
      if (answer.error === 'authorization_pending') {
        continue;
      }
      if (answer.error === 'slow_down') {
        interval += 5000;
        continue;
      }
      throw new Error(
        answer.error === 'access_denied'
          ? 'The sign-in was refused on the other device.'
          : (answer.error_description ?? 'Google did not let the trainer in.'),
      );
    }
    throw new Error('The code ran out before it was entered. Ask for a new one.');
  }

  prepare(): void {
    this.identity ??= this.options.identity();
    // Asked again on the press that needs it, where a failure can be said.
    this.identity.catch(() => {
      this.identity = null;
    });
  }

  async connect(): Promise<void> {
    const key = this.keptKey();
    if (this.options.clientId === '' && key === null) {
      throw new Error('Google Drive is not set up in this copy of the trainer.');
    }
    if (this.token === null || this.options.now() >= this.token.expiresAtMs) {
      this.token = key !== null ? await this.renew(key) : await this.signIn();
    }
    this.folderId ??= await this.findOrMakeTheFolder();
  }

  async list(): Promise<readonly CloudFile[]> {
    const folder = this.theFolder();
    const files: CloudFile[] = [];
    let page: string | undefined;
    do {
      const query = new URLSearchParams({
        q: `'${folder}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name)',
        pageSize: '1000',
      });
      if (page !== undefined) {
        query.set('pageToken', page);
      }
      const found = (await (await this.call(`${API}/files?${query.toString()}`)).json()) as {
        readonly files?: readonly CloudFile[];
        readonly nextPageToken?: string;
      };
      files.push(...(found.files ?? []).map(({ id, name }) => ({ id, name })));
      page = found.nextPageToken;
    } while (page !== undefined);
    return files;
  }

  async read(id: string): Promise<string> {
    return (await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
  }

  async write(name: string, content: string, replacing: string | null): Promise<CloudFile> {
    const type = typeOf(name);
    if (replacing !== null) {
      const response = await this.call(
        `${UPLOAD}/files/${encodeURIComponent(replacing)}?uploadType=media&fields=id,name`,
        { method: 'PATCH', headers: { 'Content-Type': type }, body: content },
      );
      return (await response.json()) as CloudFile;
    }
    const boundary = `trainer-${String(this.options.now())}`;
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name, parents: [this.theFolder()], mimeType: type }),
      `--${boundary}`,
      `Content-Type: ${type}`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');
    const response = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await response.json()) as CloudFile;
  }

  private signIn(): Promise<{ value: string; expiresAtMs: number }> {
    this.prepare();
    const identity = this.identity ?? this.options.identity();
    return identity.then(
      (google) =>
        new Promise((resolve, reject) => {
          const client = google.initTokenClient({
            client_id: this.options.clientId,
            scope: SCOPE,
            callback: (response) => {
              if (response.access_token === undefined || response.error !== undefined) {
                reject(new Error(response.error_description ?? 'Google did not let the trainer in.'));
                return;
              }
              resolve(this.tokenFrom(response.access_token, response.expires_in));
            },
            error_callback: (error) => {
              reject(
                new Error(
                  error.type === 'popup_closed'
                    ? 'The Google window was closed before signing in.'
                    : (error.message ?? 'Google sign-in did not finish.'),
                ),
              );
            },
          });
          // Empty rather than 'consent': Google asks only the first time.
          client.requestAccessToken({ prompt: '' });
        }),
    );
  }

  /** A new token from the key a code left: no window, no press. */
  private async renew(key: string): Promise<{ value: string; expiresAtMs: number }> {
    const answer = await this.askGoogle(TOKEN, {
      client_id: this.options.byCode?.clientId ?? '',
      client_secret: this.options.byCode?.clientSecret ?? '',
      refresh_token: key,
      grant_type: 'refresh_token',
    });
    if (answer.access_token !== undefined) {
      return this.tokenFrom(answer.access_token, answer.expires_in);
    }
    if (answer.error === 'invalid_grant') {
      // Taken back on the account, or run out: only a new code will do.
      this.keepKey(null);
      throw new Error('The sign-in by code has run out. Sign in with a code again.');
    }
    throw new Error(answer.error_description ?? 'Google did not renew the sign-in.');
  }

  private tokenFrom(value: string, expiresIn: number | string | undefined): { value: string; expiresAtMs: number } {
    return {
      value,
      expiresAtMs: this.options.now() + Number(expiresIn ?? 3600) * 1000 - EXPIRY_MARGIN_MS,
    };
  }

  /** A form sent to Google's sign-in, and its answer - a refusal included, which says why. */
  private async askGoogle(url: string, fields: Record<string, string>): Promise<CodeAnswer> {
    const response = await this.options.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    return (await response.json().catch(() => ({}))) as CodeAnswer;
  }

  private keptKey(): string | null {
    try {
      return this.options.byCode?.storage?.getItem(SIGN_IN_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private keepKey(key: string | null): void {
    const storage = this.options.byCode?.storage;
    try {
      if (key === null) {
        storage?.removeItem(SIGN_IN_KEY);
      } else {
        storage?.setItem(SIGN_IN_KEY, key);
      }
    } catch {
      // Not kept: this device is asked for a code again next time.
    }
  }

  private async findOrMakeTheFolder(): Promise<string> {
    const query = new URLSearchParams({
      q: `name='${FOLDER_NAME}' and mimeType='${FOLDER_TYPE}' and trashed=false`,
      fields: 'files(id,name)',
    });
    const found = (await (await this.call(`${API}/files?${query.toString()}`)).json()) as {
      readonly files?: readonly CloudFile[];
    };
    const existing = found.files?.[0];
    if (existing !== undefined) {
      return existing.id;
    }
    const made = (await (
      await this.call(`${API}/files?fields=id,name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_TYPE }),
      })
    ).json()) as CloudFile;
    return made.id;
  }

  private theFolder(): string {
    if (this.folderId === null) {
      throw new Error('Google Drive is not connected.');
    }
    return this.folderId;
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.token === null) {
      throw new Error('Google Drive is not connected.');
    }
    const response = await this.options.fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.token.value}` },
    });
    if (response.status === 401) {
      // Run out between the press and the call: the next press signs in again.
      this.token = null;
      throw new Error('Google Drive asked to sign in again. Press once more.');
    }
    if (!response.ok) {
      throw new Error(`Google Drive answered ${String(response.status)}.`);
    }
    return response;
  }
}

/** What a file is, by its name, as Drive should be told it. */
function typeOf(name: string): string {
  if (name.endsWith('.json')) {
    return 'application/json';
  }
  if (name.endsWith('.musicxml')) {
    return 'application/vnd.recordare.musicxml+xml';
  }
  return 'text/plain';
}
