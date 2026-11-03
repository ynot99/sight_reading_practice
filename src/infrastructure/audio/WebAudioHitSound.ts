import type { IHitSound } from '../../application/ports/IHitSound.js';
import { volumeToGain } from '../../application/ports/IVolumeControl.js';
import { unplug } from './audioTime.js';

export interface WebAudioHitSoundOptions {
  readonly gain?: number;
}

/**
 * A drum's hit, made of two tones rather than fetched.
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
export class WebAudioHitSound implements IHitSound {
  private readonly contextFactory: () => AudioContext;
  private readonly instrumentVolume: () => number;
  private readonly gain: number;
  private context: AudioContext | null = null;

  constructor(
    contextFactory: () => AudioContext,
    instrumentVolume: () => number,
    options: WebAudioHitSoundOptions = {},
  ) {
    this.contextFactory = contextFactory;
    this.instrumentVolume = instrumentVolume;
    this.gain = options.gain ?? 0.5;
  }

  hit(velocity: number): void {
    const level = volumeToGain(this.instrumentVolume(), this.gain);
    if (level <= 0) {
      return;
    }
    const context = this.ensureContext();
    // Now, on the audio clock: a press is answered the moment it is heard,
    // and there is nothing ahead of it to line up with.
    const at = context.currentTime;
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
    body.onended = () => {
      unplug(body, bodyEnvelope);
    };
    snap.onended = () => {
      unplug(snap, snapEnvelope);
    };
    body.start(at);
    body.stop(at + 0.15);
    snap.start(at);
    snap.stop(at + 0.03);
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      this.context = this.contextFactory();
    }
    void this.context.resume();
    return this.context;
  }
}
