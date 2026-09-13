import { describe, expect, it } from 'vitest';
import {
  keepAudioAwake,
  type WakeableAudioContext,
  type WakingTarget,
} from '../../src/infrastructure/audio/keepAudioAwake.js';

class FakeContext implements WakeableAudioContext {
  state: 'suspended' | 'running' = 'suspended';
  readonly sampleRate = 48_000;
  resumes = 0;
  sounds = 0;
  readonly destination = {};

  async resume(): Promise<void> {
    this.resumes += 1;
    this.state = 'running';
  }

  createBuffer(): unknown {
    return {};
  }

  createBufferSource(): {
    buffer: unknown;
    connect(destination: unknown): unknown;
    start(when?: number): void;
  } {
    return {
      buffer: null,
      connect: () => undefined,
      start: () => {
        this.sounds += 1;
      },
    };
  }
}

class FakeTarget implements WakingTarget {
  private readonly listeners = new Map<string, (() => void)[]>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((one) => one !== listener),
    );
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener();
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0);
  }
}

describe('keeping the audio device awake', () => {
  it('makes nothing until the reader touches the page', () => {
    // A browser will not start an audio context outside a gesture, and asking
    // before there has been one is how a page ends up with a context that is
    // suspended and stays that way.
    let made = 0;
    const page = new FakeTarget();
    keepAudioAwake(() => {
      made += 1;
      return new FakeContext();
    }, page);

    expect(made).toBe(0);

    page.fire('pointerdown');

    expect(made).toBe(1);
  });

  it('wakes it on the first touch, whichever kind of touch it is', () => {
    for (const gesture of ['pointerdown', 'touchend', 'keydown', 'mousedown']) {
      const context = new FakeContext();
      const page = new FakeTarget();
      keepAudioAwake(() => context, page);

      page.fire(gesture);

      expect(context.resumes, gesture).toBe(1);
      // And a sound of no length, which some browsers want before they believe
      // the context is really in use.
      expect(context.sounds, gesture).toBe(1);
    }
  });

  it('wakes it again when the page comes back', () => {
    // A tablet suspends the audio of a page it has put away and does not
    // resume it on return, so a context woken once is asleep again by the time
    // the reader picks the instrument back up.
    const context = new FakeContext();
    const page = new FakeTarget();
    keepAudioAwake(() => context, page);
    page.fire('pointerdown');
    context.state = 'suspended';

    page.fire('visibilitychange');

    expect(context.resumes).toBe(2);
  });

  it('wakes nothing for a page nobody has touched', () => {
    // Coming back to a page that never asked for sound is not a reason to ask
    // for it: that is exactly what browsers refuse, and rightly.
    let made = 0;
    const page = new FakeTarget();
    keepAudioAwake(() => {
      made += 1;
      return new FakeContext();
    }, page);

    page.fire('visibilitychange');

    expect(made).toBe(0);
  });

  it('calls itself asleep until something has actually woken', () => {
    // The page has to be able to say which it is: a device nobody has woken
    // will be a moment late with its first click however early the reader
    // plays, and asking for one tap is honest where seeming slow is not.
    const context = new FakeContext();
    const page = new FakeTarget();
    const waking = keepAudioAwake(() => context, page);

    expect(waking.awake()).toBe(false);

    page.fire('pointerdown');

    expect(waking.awake()).toBe(true);

    // And asleep again the moment the device says so, rather than for ever
    // after on the strength of one gesture.
    context.state = 'suspended';

    expect(waking.awake()).toBe(false);
  });

  it('lets go of every listener it took', () => {
    const page = new FakeTarget();
    const waking = keepAudioAwake(() => new FakeContext(), page);
    expect(page.listenerCount()).toBeGreaterThan(0);

    waking.stop();

    expect(page.listenerCount()).toBe(0);
  });
});
