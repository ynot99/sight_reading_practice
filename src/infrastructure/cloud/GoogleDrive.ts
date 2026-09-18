import type { CloudFile, ICloudDrive } from '../../application/ports/ICloudDrive.js';

/** Only what this program made, or what the reader opened with it - never the rest of the drive. */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
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

export interface GoogleDriveOptions {
  readonly clientId: string;
  /** Loads Google's sign-in library; the page's own script tag by default. */
  readonly identity: () => Promise<GoogleIdentity>;
  readonly fetch: Fetch;
  /** Wall-clock milliseconds, for when a token runs out. */
  readonly now: () => number;
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
 * kept in memory only: nothing that opens the drive is ever written to this
 * device. A press after it has run out signs in again, which Google does
 * without asking once the reader has agreed.
 */
export class GoogleDrive implements ICloudDrive {
  private readonly options: GoogleDriveOptions;
  private identity: Promise<GoogleIdentity> | null = null;
  private token: { readonly value: string; readonly expiresAtMs: number } | null = null;
  private folderId: string | null = null;

  constructor(options: GoogleDriveOptions) {
    this.options = options;
  }

  prepare(): void {
    this.identity ??= this.options.identity();
    // Asked again on the press that needs it, where a failure can be said.
    this.identity.catch(() => {
      this.identity = null;
    });
  }

  async connect(): Promise<void> {
    if (this.token === null || this.options.now() >= this.token.expiresAtMs) {
      this.token = await this.signIn();
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
              const seconds = Number(response.expires_in ?? 3600);
              resolve({
                value: response.access_token,
                expiresAtMs: this.options.now() + seconds * 1000 - EXPIRY_MARGIN_MS,
              });
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
