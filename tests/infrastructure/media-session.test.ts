import { describe, expect, it } from 'vitest';
import { MediaSessionKeys, type MediaSessionLike } from '../../src/infrastructure/media/MediaSessionKeys.js';
import type { WhatIsSounding } from '../../src/application/ports/IMediaKeys.js';

class FakeSession implements MediaSessionLike {
  metadata: unknown = null;
  playbackState = 'none';
  readonly handlers = new Map<string, (() => void) | null>();

  setActionHandler(action: string, handler: (() => void) | null): void {
    this.handlers.set(action, handler);
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
    // this. His: "I like to enable a music on a loop and just listen to it,
    // but if I need to stop it - I need to focus the page".
    const session = new FakeSession();
    const pressed: string[] = [];

    new MediaSessionKeys(session, named).sounding(performanceOf(true, pressed));

    for (const action of ['play', 'pause', 'stop']) {
      session.handlers.get(action)?.();
    }
    expect(pressed).toEqual(['play', 'pause', 'stop']);
  });

  it('names the piece, so the panel is not a blank one', () => {
    const session = new FakeSession();

    new MediaSessionKeys(session, named).sounding(performanceOf(true));

    expect(session.metadata).toEqual({ title: 'City of Tears' });
  });

  it('says which of play and pause the panel should offer', () => {
    // Read off the state rather than guessed from which handlers are set: both
    // are set the whole time, because held music is what the keys resume.
    const session = new FakeSession();
    const keys = new MediaSessionKeys(session, named);

    keys.sounding(performanceOf(true));
    expect(session.playbackState).toBe('playing');

    keys.sounding(performanceOf(false));
    expect(session.playbackState).toBe('paused');
    expect(session.handlers.get('play')).not.toBeNull();
  });

  it('gives the keys back when there is nothing sounding', () => {
    // A page that keeps them after its music has ended swallows them from
    // whatever the reader plays next, and a media key that does nothing is
    // worse than one that goes somewhere else.
    const session = new FakeSession();
    const keys = new MediaSessionKeys(session, named);
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

    new MediaSessionKeys(session, named).sounding(null);

    expect(session.playbackState).toBe('playing');
    expect(session.handlers.size).toBe(0);
  });

  it('says nothing at all where the platform has no keys to give', () => {
    // Off a browser, and on one too old to have this, which is one answer.
    expect(() => new MediaSessionKeys(null, named).sounding(performanceOf(true))).not.toThrow();
  });

  it('plays on where the platform cannot name what is sounding', () => {
    // The keys are the feature; the title on a lock screen is a courtesy, and
    // a browser missing the one must still be handed the other.
    const session = new FakeSession();

    new MediaSessionKeys(session, null).sounding(performanceOf(true));

    expect(session.playbackState).toBe('playing');
    expect(session.handlers.get('pause')).not.toBeNull();
  });
});
