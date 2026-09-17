import type { IMediaKeys, WhatIsSounding } from '../../application/ports/IMediaKeys.js';

/** The corner of `navigator.mediaSession` this needs, named so a test can stand in. */
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: string;
  setActionHandler(action: string, handler: (() => void) | null): void;
}

/** The actions taken, and given back in the same order they were taken. */
const ACTIONS = ['play', 'pause', 'stop'] as const;

/**
 * The platform's transport keys, through the Media Session API.
 *
 * A browser hands these to a page it believes is *playing media*, and what it
 * believes that from is not the same everywhere. Chromium builds the idea from
 * an `<audio>` or `<video>` element making an audible sound; this program has
 * neither, because every sound it makes is Web Audio - a click scheduled on an
 * `AudioContext`, a sampled piano note. So the handlers below may be registered
 * and never called, and there is nothing in the page that can tell: the keys go
 * somewhere else and no event arrives here to say so.
 *
 * That is why this is written as it is and no further. The way to force the
 * question is to keep a silent looping `<audio>` element playing for as long as
 * the Web Audio does, which is enough to make a browser count the page as a
 * player - a real technique and a widely used one, and also a piece of audio
 * that exists solely to convince software of something untrue. It is his call
 * whether it goes in, so what is here is the honest half: if his browser hands
 * the keys over, this is the whole feature, and if it does not, nothing has
 * been built on a trick in the meantime.
 */
export class MediaSessionKeys implements IMediaKeys {
  private readonly session: MediaSessionLike | null;
  private readonly makeMetadata: ((title: string) => unknown) | null;
  private held = false;

  constructor(session: MediaSessionLike | null, makeMetadata: ((title: string) => unknown) | null) {
    this.session = session;
    this.makeMetadata = makeMetadata;
  }

  sounding(what: WhatIsSounding | null): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    if (what === null) {
      // Given back rather than left pointing at a performance that has ended.
      // Only where they were taken: writing `none` over a page that never had
      // them would stamp on whatever else the platform is showing.
      if (!this.held) {
        return;
      }
      for (const action of ACTIONS) {
        session.setActionHandler(action, null);
      }
      session.metadata = null;
      session.playbackState = 'none';
      this.held = false;
      return;
    }
    if (this.makeMetadata !== null) {
      session.metadata = this.makeMetadata(what.title);
    }
    // Which of play and pause the panel offers is read off this, not guessed
    // from which handlers are set: both are set the whole time, because a
    // performance being held is one the same keys have to be able to resume.
    session.playbackState = what.playing ? 'playing' : 'paused';
    session.setActionHandler('play', what.play);
    session.setActionHandler('pause', what.pause);
    session.setActionHandler('stop', what.stop);
    this.held = true;
  }
}

/**
 * The page's own media session, where the browser has one.
 *
 * `null` off a browser and on one too old to have it, which is the same answer:
 * there are no keys to take.
 */
export function theMediaSession(): MediaSessionKeys {
  if (typeof navigator === 'undefined') {
    return new MediaSessionKeys(null, null);
  }
  const session = (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession;
  const Metadata = (globalThis as unknown as { MediaMetadata?: new (init: { title: string }) => unknown })
    .MediaMetadata;
  return new MediaSessionKeys(
    session ?? null,
    Metadata === undefined ? null : (title: string) => new Metadata({ title }),
  );
}
