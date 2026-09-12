import { describe, expect, it } from 'vitest';
import {
  ScreenWakeLock,
  type VisibilityTarget,
  type WakeLockSentinelLike,
} from '../../src/infrastructure/screen/ScreenWakeLock.js';

class FakeSentinel implements WakeLockSentinelLike {
  released = false;

  async release(): Promise<void> {
    this.released = true;
  }
}

class FakeNavigator {
  readonly sentinels: FakeSentinel[] = [];
  requests = 0;
  refuse = false;

  readonly wakeLock = {
    request: async (type: 'screen'): Promise<WakeLockSentinelLike> => {
      expect(type).toBe('screen');
      this.requests += 1;
      if (this.refuse) {
        throw new Error('not allowed');
      }
      const sentinel = new FakeSentinel();
      this.sentinels.push(sentinel);
      return sentinel;
    },
  };
}

class FakePage implements VisibilityTarget {
  hidden = false;
  private readonly listeners: (() => void)[] = [];

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    const at = this.listeners.indexOf(listener);
    if (at >= 0) {
      this.listeners.splice(at, 1);
    }
  }

  /** What the browser does when the page goes away and comes back. */
  goAway(): void {
    this.hidden = true;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  comeBack(): void {
    this.hidden = false;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/** Lets the promises inside the adapter settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('the screen wake lock', () => {
  it('asks for the screen and gives it back', async () => {
    const navigator = new FakeNavigator();
    const page = new FakePage();
    const wake = new ScreenWakeLock(navigator, page);

    wake.hold();
    await settle();

    expect(navigator.requests).toBe(1);
    expect(navigator.sentinels[0]?.released).toBe(false);

    wake.release();

    expect(navigator.sentinels[0]?.released).toBe(true);
  });

  it('asks again when the page comes back', async () => {
    // The one thing everybody gets wrong. The browser takes the lock back the
    // moment the page stops being visible and does not return it, so a request
    // made once works until the first interruption and never again - which is
    // worse than not asking, because it looks as though it works.
    const navigator = new FakeNavigator();
    const page = new FakePage();
    const wake = new ScreenWakeLock(navigator, page);
    wake.hold();
    await settle();

    page.goAway();
    page.comeBack();
    await settle();

    expect(navigator.requests).toBe(2);
  });

  it('does not ask again for a screen nobody wants any more', async () => {
    const navigator = new FakeNavigator();
    const page = new FakePage();
    const wake = new ScreenWakeLock(navigator, page);
    wake.hold();
    await settle();
    wake.release();

    page.goAway();
    page.comeBack();
    await settle();

    expect(navigator.requests).toBe(1);
  });

  it('lets go of a lock that arrives after the run has ended', async () => {
    // The request is a promise, and a run can end while it is in flight.
    const navigator = new FakeNavigator();
    const wake = new ScreenWakeLock(navigator, new FakePage());

    wake.hold();
    wake.release();
    await settle();

    expect(navigator.sentinels[0]?.released).toBe(true);
  });

  it('survives a browser that refuses, and one that cannot', async () => {
    // No support, no secure context, a battery-saving mode: a refusal is not
    // something a run should ever have to handle. The screen turning off is a
    // nuisance; a trainer that stopped working over one would be worse.
    const refusing = new FakeNavigator();
    refusing.refuse = true;
    const wake = new ScreenWakeLock(refusing, new FakePage());

    wake.hold();
    await settle();
    wake.release();

    expect(refusing.requests).toBe(1);

    const without = new ScreenWakeLock({}, new FakePage());

    expect(() => {
      without.hold();
      without.release();
    }).not.toThrow();
  });

  it('asks nothing while the page is hidden', async () => {
    const navigator = new FakeNavigator();
    const page = new FakePage();
    page.hidden = true;
    const wake = new ScreenWakeLock(navigator, page);

    wake.hold();
    await settle();

    expect(navigator.requests).toBe(0);

    page.comeBack();
    await settle();

    expect(navigator.requests).toBe(1);
  });
});
