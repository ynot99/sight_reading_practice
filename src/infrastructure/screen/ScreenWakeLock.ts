import type { IScreenWake } from '../../application/ports/IScreenWake.js';

/** What the browser hands back, of which only the giving up is used. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
}

/** The corner of `navigator` this needs, named so a test can stand in for it. */
export interface WakeLockCapable {
  readonly wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
}

/** And the corner of `document`: whether the page is on screen, and when that changes. */
export interface VisibilityTarget {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * The screen wake lock, and the one thing everybody gets wrong about it.
 *
 * The browser takes the lock back the moment the page stops being visible -
 * another tab, the app going to the background, the screen locked by hand -
 * and does not give it back when the page returns. A request made once
 * therefore works exactly until the first interruption and never again, which
 * is worse than not asking, because it looks as though it works.
 *
 * So what is remembered here is not the lock but the *wish* for one, and the
 * wish is answered again every time the page comes back.
 *
 * Everything is fire-and-forget. The request is a promise that can be refused
 * - no support, no secure context, a battery-saving mode - and a refusal is
 * not something a run should ever have to handle: the screen turning off is a
 * nuisance, and a trainer that stopped working over one would be worse.
 */
export class ScreenWakeLock implements IScreenWake {
  private readonly navigator: WakeLockCapable;
  private readonly page: VisibilityTarget;
  private readonly onVisibilityChange: () => void;
  private sentinel: WakeLockSentinelLike | null = null;
  /** Whether a lock is being asked for right now, so two are never in flight. */
  private asking = false;
  /** Whether the reader wants the screen up, whatever the browser has done. */
  private wanted = false;

  constructor(navigatorLike: WakeLockCapable, page: VisibilityTarget) {
    this.navigator = navigatorLike;
    this.page = page;
    this.onVisibilityChange = (): void => {
      if (this.page.hidden) {
        // The browser has taken the lock back; holding the sentinel would only
        // make the next request look unnecessary.
        this.sentinel = null;
        return;
      }
      if (this.wanted) {
        this.ask();
      }
    };
    this.page.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  hold(): void {
    this.wanted = true;
    this.ask();
  }

  release(): void {
    this.wanted = false;
    const held = this.sentinel;
    this.sentinel = null;
    void held?.release().catch(() => undefined);
  }

  /** Releases the lock and stops listening; the page is going away. */
  dispose(): void {
    this.release();
    this.page.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private ask(): void {
    const api = this.navigator.wakeLock;
    if (api === undefined || this.sentinel !== null || this.asking || this.page.hidden) {
      return;
    }
    this.asking = true;
    void api
      .request('screen')
      .then((sentinel) => {
        this.asking = false;
        if (!this.wanted) {
          // Let go while the asking was in flight: the run ended, and a lock
          // arriving after that would be held for nobody.
          void sentinel.release().catch(() => undefined);
          return;
        }
        this.sentinel = sentinel;
      })
      .catch(() => {
        this.asking = false;
      });
  }
}
