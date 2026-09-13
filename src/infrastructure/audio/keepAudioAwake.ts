/** The corner of an `AudioContext` this needs, named so a test can stand in. */
export interface WakeableAudioContext {
  readonly state: 'suspended' | 'running' | 'closed' | string;
  readonly sampleRate: number;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): unknown;
  createBufferSource(): {
    buffer: unknown;
    connect(destination: unknown): unknown;
    start(when?: number): void;
  };
  readonly destination: unknown;
}

/** Where the first touch of the page arrives, and where visibility changes. */
export interface WakingTarget {
  addEventListener(type: string, listener: () => void, options?: unknown): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Events that count as the reader touching the page.
 *
 * Broad on purpose: a browser will only start audio inside a gesture it
 * believes in, and which gestures those are differs between them. Every one of
 * these is a real interaction, and the first to arrive is enough.
 */
const GESTURES = ['pointerdown', 'touchend', 'keydown', 'mousedown'] as const;

/**
 * Keeps the audio device awake, from the first moment the reader touches the
 * page until they leave it.
 *
 * A browser will not start an audio context outside a user gesture, and a key
 * on a MIDI keyboard is not one: as far as the page is concerned nobody has
 * touched it. So the first thing that ever asked for sound - which, in a
 * trainer whose runs can begin by playing, is a chord on the piano - created a
 * context that was suspended, and then waited for it. `currentTime` does not
 * advance while a context is suspended, so no click could be scheduled and no
 * tick delivered: the whole run stood still until something *else* woke the
 * device, which on a tablet meant a finger on the screen.
 *
 * The cure is not to measure the wait or to start the music without it. It is
 * for the device to be awake already, so that asking for a click and hearing
 * one are the same moment. His: "чи можливо якось щоб аудіо контекст вже був
 * живим, щоб була нульова затримка?" - and playing *with* the metronome rather
 * than with an estimate of it is what this program is for.
 *
 * Two things are needed and both are easy to forget. The context is created
 * and resumed inside the first gesture, whatever it is. And it is resumed
 * again whenever the page comes back, because a tablet suspends the audio of
 * a page it has put away and does not resume it on return.
 */
/** What a caller can ask of the waking, once it is armed. */
export interface AudioWaking {
  /** Whether the device is awake and can sound something at once. */
  awake(): boolean;
  /** Stops listening. */
  stop(): void;
}

export function keepAudioAwake(
  contextFactory: () => WakeableAudioContext,
  page: WakingTarget,
  visibility: WakingTarget = page,
): AudioWaking {
  let context: WakeableAudioContext | null = null;

  const wake = (): void => {
    context ??= contextFactory();
    if (context.state !== 'running') {
      void context.resume().catch(() => undefined);
    }
    // A sound of no length at all, which some browsers want before they will
    // believe the context is really being used. Costs nothing and is silent.
    try {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate);
      source.connect(context.destination);
      source.start(0);
    } catch {
      // A context that will not make a buffer is a context that was never
      // going to sound anything; there is nothing to do about it here.
    }
  };

  const onGesture = (): void => {
    wake();
  };
  const onVisible = (): void => {
    // Only where something has already asked for sound: waking a device for a
    // page nobody has touched is exactly what browsers refuse, and rightly.
    if (context !== null) {
      wake();
    }
  };

  for (const gesture of GESTURES) {
    page.addEventListener(gesture, onGesture, { passive: true });
  }
  visibility.addEventListener('visibilitychange', onVisible);

  return {
    // Nothing asked for yet is not awake: a page the reader has not touched
    // cannot sound anything, and saying otherwise would be the one lie this
    // is for.
    awake: () => context !== null && context.state === 'running',
    stop: () => {
      for (const gesture of GESTURES) {
        page.removeEventListener(gesture, onGesture);
      }
      visibility.removeEventListener('visibilitychange', onVisible);
    },
  };
}
