import { describe, expect, it } from 'vitest';
import {
  MediaSessionKeys,
  silentWav,
  type MediaSessionLike,
  type SilentPlayer,
} from '../../src/infrastructure/media/MediaSessionKeys.js';
import type { WhatIsSounding } from '../../src/application/ports/IMediaKeys.js';

class FakeSession implements MediaSessionLike {
  metadata: unknown = null;
  playbackState = 'none';
  readonly handlers = new Map<string, (() => void) | null>();

  setActionHandler(action: string, handler: (() => void) | null): void {
    this.handlers.set(action, handler);
  }
}

class FakeSilence implements SilentPlayer {
  playing = false;

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }
}

function performanceOf(playing: boolean, pressed: string[] = []): WhatIsSounding {
  return {
    title: 'City of Tears',
    playing,
    play: () => pressed.push('play'),
    pause: () => pressed.push('pause'),
    stop: () => pressed.push('stop'),
  };
}

const named = (title: string): unknown => ({ title });

describe('the platform transport keys', () => {
  it('takes the three keys a performance can answer', () => {
    // They reach a page nobody is looking at, which is the whole reason for
    // this: music left playing can be stopped without finding the tab.
    const session = new FakeSession();
    const pressed: string[] = [];

    new MediaSessionKeys(session, named, null).sounding(performanceOf(true, pressed));

    for (const action of ['play', 'pause', 'stop']) {
      session.handlers.get(action)?.();
    }
    expect(pressed).toEqual(['play', 'pause', 'stop']);
  });

  it('names the piece, so the panel is not a blank one', () => {
    const session = new FakeSession();

    new MediaSessionKeys(session, named, null).sounding(performanceOf(true));

    expect(session.metadata).toEqual({ title: 'City of Tears' });
  });

  it('says which of play and pause the panel should offer', () => {
    // Read off the state rather than guessed from which handlers are set: both
    // are set the whole time, because held music is what the keys resume.
    const session = new FakeSession();
    const keys = new MediaSessionKeys(session, named, null);

    keys.sounding(performanceOf(true));
    expect(session.playbackState).toBe('playing');

    keys.sounding(performanceOf(false));
    expect(session.playbackState).toBe('paused');
    expect(session.handlers.get('play')).not.toBeNull();
  });

  it('plays silence while the music plays, holds it with the music, and lets it go with it', () => {
    // A browser hands the keys only to a page with a media element playing;
    // every sound here is Web Audio, so without this they never arrived.
    const session = new FakeSession();
    const silence = new FakeSilence();
    const keys = new MediaSessionKeys(session, named, silence);

    keys.sounding(performanceOf(true));
    expect(silence.playing).toBe(true);

    keys.sounding(performanceOf(false));
    expect(silence.playing).toBe(false);

    keys.sounding(performanceOf(true));
    keys.sounding(null);
    expect(silence.playing).toBe(false);
  });

  it('gives the keys back when there is nothing sounding', () => {
    // A page that keeps them after its music has ended swallows them from
    // whatever the reader plays next, and a media key that does nothing is
    // worse than one that goes somewhere else.
    const session = new FakeSession();
    const keys = new MediaSessionKeys(session, named, null);
    keys.sounding(performanceOf(true));

    keys.sounding(null);

    expect(session.playbackState).toBe('none');
    expect(session.metadata).toBeNull();
    expect([...session.handlers.values()]).toEqual([null, null, null]);
  });

  it('stands on nothing it never took', () => {
    // Writing "none" over a page that never had the keys would stamp on
    // whatever else the platform is showing for it.
    const session = new FakeSession();
    session.playbackState = 'playing';

    new MediaSessionKeys(session, named, null).sounding(null);

    expect(session.playbackState).toBe('playing');
    expect(session.handlers.size).toBe(0);
  });

  it('says nothing at all where the platform has no keys to give', () => {
    // Off a browser, and on one too old to have this, which is one answer.
    const silence = new FakeSilence();
    expect(() => new MediaSessionKeys(null, named, silence).sounding(performanceOf(true))).not.toThrow();
    // Nor plays silence for keys nobody will hand over.
    expect(silence.playing).toBe(false);
  });

  it('plays on where the platform cannot name what is sounding', () => {
    // The keys are the feature; the title on a lock screen is a courtesy, and
    // a browser missing the one must still be handed the other.
    const session = new FakeSession();

    new MediaSessionKeys(session, null, null).sounding(performanceOf(true));

    expect(session.playbackState).toBe('playing');
    expect(session.handlers.get('pause')).not.toBeNull();
  });
});

describe('the silence played beside the music', () => {
  it('is a WAV file of zeros, as long as it says', () => {
    const bytes = silentWav(2, 8_000);
    const view = new DataView(bytes.buffer);
    const text = (at: number, length: number): string =>
      String.fromCharCode(...bytes.slice(at, at + length));

    expect(text(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(text(8, 8)).toBe('WAVEfmt ');
    // PCM, one channel, 8 kHz, 16-bit.
    expect([view.getUint16(20, true), view.getUint16(22, true)]).toEqual([1, 1]);
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint32(28, true)).toBe(16_000);
    expect([view.getUint16(32, true), view.getUint16(34, true)]).toEqual([2, 16]);
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(2 * 8_000 * 2);
    expect(bytes.length).toBe(44 + 2 * 8_000 * 2);
    expect(bytes.slice(44).every((byte) => byte === 0)).toBe(true);
  });
});
