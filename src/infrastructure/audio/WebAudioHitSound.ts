import type { IPitchPlayer } from '../../application/ports/IPitchPlayer.js';
import { volumeToGain } from '../../application/ports/IVolumeControl.js';
import { AudioClockReading, audioTimeFor, takeBack, tooLateToSound, unplug } from './audioTime.js';

export interface WebAudioHitSoundOptions {
  readonly gain?: number;
  /** The crossing between the clocks shared with the instrument, so a hit lands where its note would. */
  readonly reading?: AudioClockReading;
}

/** One hit on the audio clock, with what it takes to silence it. */
interface Hit {
  readonly body: OscillatorNode;
  readonly bodyEnvelope: GainNode;
  readonly snap: OscillatorNode;
  readonly snapEnvelope: GainNode;
  /** When it begins, on the audio clock: later than now for one handed over ahead. */
  readonly startsAt: number;
}

/**
 * A drum, every key of it the same hit - made of two tones rather than fetched.
 *
 * Where only the moment of a key is judged, which key it was is nobody's
 * question, and sounded as itself it plays a tune nobody wrote: on a
 * computer's keyboard, whichever letters were nearest. So the press is heard
 * as a drum is - and an instrument rather than a sound of its own, so that a
 * run tapped this way plays back through it as it was heard.
 *
 * A body that falls in pitch as it dies, which is what makes a struck skin
 * sound struck, and a short bright snap over its first moment, which is where
 * the ear places it in time. Unlike the click - a square wave held level for
 * fifty milliseconds - so a hit and a beat landing together are heard as two
 * things, and a press is never mistaken for the metronome.
 *
 * As loud as the instrument: it stands in for the instrument's note, and a
 * reader who turned the piano down has said how loud their keys should be.
 */
export class WebAudioHitSound implements IPitchPlayer {
  private readonly contextFactory: () => AudioContext;
  private readonly instrumentVolume: () => number;
  private readonly gain: number;
  private readonly reading: AudioClockReading;
  /** Every hit handed over and not yet over: what silencing has to reach. */
  private readonly sounding = new Set<Hit>();
  private context: AudioContext | null = null;

  constructor(
    contextFactory: () => AudioContext,
    instrumentVolume: () => number,
    options: WebAudioHitSoundOptions = {},
  ) {
    this.contextFactory = contextFactory;
    this.instrumentVolume = instrumentVolume;
    this.gain = options.gain ?? 0.5;
    this.reading = options.reading ?? new AudioClockReading();
  }

  /** Strikes the drum, whichever key it was: now, or at a moment handed over ahead. */
  play(_midi: number, velocity: number, atMs?: number): void {
    const level = volumeToGain(this.instrumentVolume(), this.gain);
    if (level <= 0) {
      return;
    }
    const context = this.ensureContext();
    if (tooLateToSound(atMs, performance.now(), { context, reading: this.reading })) {
      return;
    }
    const at = audioTimeFor(context, atMs, this.reading);
    // The same floor the instrument keeps, so the softest press is still heard.
    const peak = Math.max(0.001, level * Math.max(0.05, velocity));

    const body = context.createOscillator();
    const bodyEnvelope = context.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(190, at);
    body.frequency.exponentialRampToValueAtTime(70, at + 0.09);
    bodyEnvelope.gain.setValueAtTime(0.0001, at);
    bodyEnvelope.gain.exponentialRampToValueAtTime(peak, at + 0.003);
    bodyEnvelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);

    const snap = context.createOscillator();
    const snapEnvelope = context.createGain();
    snap.type = 'triangle';
    snap.frequency.setValueAtTime(1800, at);
    snapEnvelope.gain.setValueAtTime(0.0001, at);
    snapEnvelope.gain.exponentialRampToValueAtTime(peak * 0.45, at + 0.001);
    snapEnvelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);

    body.connect(bodyEnvelope).connect(context.destination);
    snap.connect(snapEnvelope).connect(context.destination);
    const hit: Hit = { body, bodyEnvelope, snap, snapEnvelope, startsAt: at };
    body.onended = () => {
      this.sounding.delete(hit);
      unplug(body, bodyEnvelope);
    };
    snap.onended = () => {
      unplug(snap, snapEnvelope);
    };
    body.start(at);
    body.stop(at + 0.15);
    snap.start(at);
    snap.stop(at + 0.03);
    this.sounding.add(hit);
  }

  /** A hit has no length to cut: it is over by itself before any key comes up. */
  stop(_midi: number, _atMs?: number): void {
    // Intentionally nothing.
  }

  stopAll(): void {
    const context = this.context;
    for (const hit of this.sounding) {
      this.silence(hit, context?.currentTime ?? 0);
    }
    this.sounding.clear();
  }

  takeBackFrom(atMs: number): void {
    const context = this.context;
    if (context === null) {
      return;
    }
    const from = audioTimeFor(context, atMs, this.reading);
    for (const hit of this.sounding) {
      if (hit.startsAt > from) {
        this.silence(hit, context.currentTime);
        this.sounding.delete(hit);
      }
    }
  }

  private silence(hit: Hit, now: number): void {
    takeBack(hit.body, hit.bodyEnvelope, now);
    takeBack(hit.snap, hit.snapEnvelope, now);
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      this.context = this.contextFactory();
    }
    void this.context.resume();
    return this.context;
  }
}
