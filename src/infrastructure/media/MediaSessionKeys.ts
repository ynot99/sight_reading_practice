import type { IMediaKeys, WhatIsSounding } from '../../application/ports/IMediaKeys.js';

/** The corner of `navigator.mediaSession` this needs, named so a test can stand in. */
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: string;
  setActionHandler(action: string, handler: (() => void) | null): void;
}

/** An element playing nothing, which is what makes a browser count the page as a player. */
export interface SilentPlayer {
  play(): void;
  pause(): void;
}

/** The actions taken, and given back in the same order they were taken. */
const ACTIONS = ['play', 'pause', 'stop'] as const;

/**
 * The platform's transport keys, through the Media Session API.
 *
 * A browser hands these to a page it believes is *playing media*, and Chromium
 * builds that belief from an `<audio>` or `<video>` element that is playing.
 * Every sound this program makes is Web Audio - a click scheduled on an
 * `AudioContext`, a sampled piano note - so with the handlers alone they were
 * registered and never called: the keys went to some other application and
 * nothing arrived here to say so.
 *
 * So an element is played beside the music: silence on a loop, started and
 * held with the performance and let go of with it. It carries none of the
 * sound. Routing the real sound through an element would have made the
 * browser believe the same thing, at the cost of another hop between the
 * scheduler and the speaker on the one path whose timing everything here is
 * judged against.
 */
export class MediaSessionKeys implements IMediaKeys {
  private readonly session: MediaSessionLike | null;
  private readonly makeMetadata: ((title: string) => unknown) | null;
  private readonly silence: SilentPlayer | null;
  private held = false;

  constructor(
    session: MediaSessionLike | null,
    makeMetadata: ((title: string) => unknown) | null,
    silence: SilentPlayer | null,
  ) {
    this.session = session;
    this.makeMetadata = makeMetadata;
    this.silence = silence;
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
      this.silence?.pause();
      for (const action of ACTIONS) {
        session.setActionHandler(action, null);
      }
      session.metadata = null;
      session.playbackState = 'none';
      this.held = false;
      return;
    }
    // Held with the music rather than played on: a player that is still
    // playing is one the browser offers Pause for, over music that has stopped.
    if (what.playing) {
      this.silence?.play();
    } else {
      this.silence?.pause();
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
 * A WAV file of silence: 16-bit mono PCM, every sample zero.
 *
 * Built here rather than shipped, being a header and a run of zeros. Long
 * enough to be taken for a piece of media rather than a notification sound,
 * which a browser may decline to give the keys to.
 */
export function silentWav(seconds: number, sampleRate = 8_000): Uint8Array<ArrayBuffer> {
  const samples = Math.round(seconds * sampleRate);
  const dataBytes = samples * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(at + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** How long the silence goes before it loops. */
const SILENCE_SECONDS = 10;

/**
 * Silence on a loop in an `<audio>` element, made the first time it is asked
 * to play: a page that never plays a performance never builds it.
 */
class LoopedSilence implements SilentPlayer {
  private element: HTMLAudioElement | null = null;

  play(): void {
    if (this.element === null) {
      const url = URL.createObjectURL(new Blob([silentWav(SILENCE_SECONDS)], { type: 'audio/wav' }));
      this.element = new Audio(url);
      this.element.loop = true;
    }
    // Refused where the browser wants a press first. The music itself was
    // started by one, so this is the rare case, and the keys are then only
    // not handed over - nothing else depends on it.
    this.element.play().catch(() => undefined);
  }

  pause(): void {
    this.element?.pause();
  }
}

/**
 * The page's own media session, where the browser has one.
 *
 * No session off a browser and on one too old to have it, which is the same
 * answer: there are no keys to take.
 */
export function theMediaSession(): MediaSessionKeys {
  if (typeof navigator === 'undefined') {
    return new MediaSessionKeys(null, null, null);
  }
  const session = (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession;
  const Metadata = (globalThis as unknown as { MediaMetadata?: new (init: { title: string }) => unknown })
    .MediaMetadata;
  return new MediaSessionKeys(
    session ?? null,
    Metadata === undefined ? null : (title: string) => new Metadata({ title }),
    typeof Audio === 'function' && typeof URL.createObjectURL === 'function' ? new LoopedSilence() : null,
  );
}
