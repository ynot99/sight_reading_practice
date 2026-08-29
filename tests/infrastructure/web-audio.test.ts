import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetronomeTick } from '../../src/application/ports/IMetronome.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { WebAudioMetronome } from '../../src/infrastructure/audio/WebAudioMetronome.js';
import { WebAudioPitchPlayer } from '../../src/infrastructure/audio/WebAudioPitchPlayer.js';

class FakeParam {
  value = 0;
  readonly ramps: { value: number; time: number }[] = [];
  cancelled = 0;

  setValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.ramps.push({ value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeParam {
    this.ramps.push({ value, time });
    return this;
  }

  cancelScheduledValues(): FakeParam {
    this.cancelled += 1;
    return this;
  }
}

class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  type = '';
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  connect(target: FakeNode): FakeNode {
    return target;
  }

  start(at: number): void {
    this.startedAt = at;
  }

  stop(at: number): void {
    this.stoppedAt = at;
  }
}

class FakeAudioContext {
  currentTime = 0;
  resumeCalls = 0;
  /** Seconds between a sound being scheduled and leaving the device. */
  outputLatency = 0;
  readonly destination = new FakeNode();
  readonly oscillators: FakeNode[] = [];
  readonly gains: FakeNode[] = [];

  createOscillator(): FakeNode {
    const node = new FakeNode();
    this.oscillators.push(node);
    return node;
  }

  createGain(): FakeNode {
    const node = new FakeNode();
    this.gains.push(node);
    return node;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    return Promise.resolve();
  }

  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}

function contextFactory(context: FakeAudioContext): () => AudioContext {
  return () => context as unknown as AudioContext;
}

describe('WebAudioMetronome', () => {
  let context: FakeAudioContext;
  let metronome: WebAudioMetronome;
  let ticks: MetronomeTick[];

  beforeEach(() => {
    vi.useFakeTimers();
    context = new FakeAudioContext();
    metronome = new WebAudioMetronome(contextFactory(context), {
      schedulerIntervalMs: 20,
      scheduleAheadSec: 0.12,
    });
    metronome.configure({
      bpm: 60,
      timeSignature: new TimeSignature(4, 4),
      subdivisionsPerPulse: 1,
      click: 'pulse',
      dropout: null,
      muted: false,
    });
    ticks = [];
    metronome.onTick((tick) => ticks.push(tick));
  });

  afterEach(() => {
    metronome.stop();
    vi.useRealTimers();
  });

  it('schedules audio ahead of time but delivers ticks when they are due', () => {
    metronome.start();

    expect(context.resumeCalls).toBe(1);
    expect(context.oscillators.length).toBeGreaterThan(0);
    // Nothing is audible yet, so nothing has been delivered.
    expect(ticks).toHaveLength(0);

    context.advance(0.06);
    vi.advanceTimersByTime(20);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.index).toBe(0);
    expect(ticks[0]?.isDownbeat).toBe(true);
  });

  it('ticks for the loop but only clicks where the pattern says', () => {
    // Sixteenth-note resolution with a click on the beat: the loop still has
    // to tick four times, and the reader must still hear one sound.
    metronome.configure({
      bpm: 60,
      timeSignature: new TimeSignature(4, 4),
      subdivisionsPerPulse: 4,
      click: 'pulse',
      dropout: null,
      muted: false,
    });
    metronome.start();
    // A subdivision is 250 ms here, so run the clock out over several beats.
    for (let step = 0; step < 30; step += 1) {
      context.advance(0.05);
      vi.advanceTimersByTime(20);
    }

    expect(ticks.length).toBeGreaterThanOrEqual(5);
    // One oscillator per audible click, and the pulse comes once per four.
    expect(context.oscillators.length).toBe(
      ticks.filter((tick) => tick.isPulse).length,
    );
  });

  it('keeps the pulse at the configured tempo', () => {
    metronome.start();
    context.advance(0.06);
    vi.advanceTimersByTime(20);

    // One second per beat at 60 bpm with one subdivision per beat.
    context.advance(1);
    vi.advanceTimersByTime(20);
    context.advance(1);
    vi.advanceTimersByTime(20);

    expect(ticks.map((tick) => tick.index)).toEqual([0, 1, 2]);
    expect(ticks.map((tick) => tick.beat)).toEqual([1, 2, 3]);
    expect(ticks.map((tick) => tick.positionTicks)).toEqual([0, 480, 960]);

    const [first, second] = ticks;
    expect((second?.scheduledTimeMs ?? 0) - (first?.scheduledTimeMs ?? 0)).toBeCloseTo(1000, 6);
  });

  it('accents downbeats above other beats', () => {
    metronome.start();
    const [downbeat, offbeat] = context.oscillators;

    expect(downbeat?.frequency.value).toBeGreaterThan(offbeat?.frequency.value ?? 0);
    expect(downbeat?.type).toBe('square');
  });

  it('scales the click with the volume, and goes silent at zero', () => {
    metronome.setVolume(0);
    metronome.start();
    context.advance(0.06);
    vi.advanceTimersByTime(20);

    expect(metronome.volume).toBe(0);
    expect(context.oscillators).toHaveLength(0);
    // The pulse itself keeps running; only the sound is gone.
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('keeps the pulse but makes no sound when muted', () => {
    metronome.configure({
      bpm: 60,
      timeSignature: new TimeSignature(4, 4),
      subdivisionsPerPulse: 1,
      click: 'pulse',
      dropout: null,
      muted: true,
    });
    metronome.start();
    context.advance(0.06);
    vi.advanceTimersByTime(20);

    expect(context.oscillators).toHaveLength(0);
    expect(ticks).toHaveLength(1);
  });

  it('reports whether it is running and stops cleanly', () => {
    expect(metronome.isRunning).toBe(false);

    metronome.start();
    expect(metronome.isRunning).toBe(true);

    metronome.start();
    metronome.stop();
    expect(metronome.isRunning).toBe(false);

    const delivered = ticks.length;
    context.advance(5);
    vi.advanceTimersByTime(200);
    expect(ticks).toHaveLength(delivered);
  });

  it('restarts its counters on a second run', () => {
    metronome.start();
    context.advance(2);
    vi.advanceTimersByTime(20);
    metronome.stop();
    ticks = [];
    metronome.onTick((tick) => ticks.push(tick));

    metronome.start();
    context.advance(0.06);
    vi.advanceTimersByTime(20);

    expect(ticks[0]?.index).toBe(0);
  });
});

describe('WebAudioPitchPlayer', () => {
  it('sounds a note at its equal-tempered frequency', () => {
    const context = new FakeAudioContext();
    const player = new WebAudioPitchPlayer(contextFactory(context));

    player.play(69, 0.8);

    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0]?.frequency.value).toBeCloseTo(440, 6);
    expect(context.oscillators[0]?.startedAt).toBe(0);
    expect(context.resumeCalls).toBe(1);
  });

  it('releases a note when the key comes up', () => {
    const context = new FakeAudioContext();
    const player = new WebAudioPitchPlayer(contextFactory(context), { releaseSec: 0.2 });

    player.play(60, 0.5);
    context.advance(1);
    player.stop(60);

    expect(context.oscillators[0]?.stoppedAt).toBeCloseTo(1.22, 6);
    // Anchored at the level it had, then faded from there to silence.
    const gain = context.gains[0]?.gain;
    expect(gain?.ramps.at(-1)).toEqual({ value: 0.0001, time: 1.2 });
    expect(gain?.ramps.at(-2)?.time).toBe(1);
  });

  it('releases a scheduled note without a step in its envelope', () => {
    // A note handed over before it sounds has a gain of nothing yet, so pinning
    // "the current value" at the release moment drops it from full volume to
    // silence in one sample - a click on every note of a playback.
    const context = new FakeAudioContext();
    const player = new WebAudioPitchPlayer(contextFactory(context), { releaseSec: 0.2 });
    const now = performance.now();

    player.play(60, 0.5, now + 500);
    player.stop(60, now + 1500);

    const gain = context.gains[0]?.gain;
    const anchor = gain?.ramps.at(-2);
    const fade = gain?.ramps.at(-1);
    // The fade begins at the release moment and ends a release later. A
    // fraction of a millisecond passes between reading the clock here and
    // inside the player, which is what real scheduling looks like.
    expect(anchor?.time ?? 0).toBeCloseTo(1.5, 3);
    expect(fade?.value).toBe(0.0001);
    expect(fade?.time ?? 0).toBeCloseTo(1.7, 3);
    // And it begins from a real level. Anchoring at what the envelope holds
    // *now* would read silence, and the note would cut instead of fading.
    expect(anchor?.value ?? 0).toBeGreaterThan(0.01);
  });

  it('retriggers a repeated note instead of stacking voices', () => {
    const context = new FakeAudioContext();
    const player = new WebAudioPitchPlayer(contextFactory(context));

    player.play(60, 0.5);
    player.play(60, 0.5);

    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[0]?.stoppedAt).not.toBeNull();
    expect(context.oscillators[1]?.stoppedAt).toBeNull();
  });

  it('caps the number of simultaneous voices', () => {
    const context = new FakeAudioContext();
    const player = new WebAudioPitchPlayer(contextFactory(context), { maxVoices: 2 });

    player.play(60, 0.5);
    player.play(64, 0.5);
    player.play(67, 0.5);

    // The oldest voice was released to make room.
    expect(context.oscillators[0]?.stoppedAt).not.toBeNull();
    expect(context.oscillators[2]?.stoppedAt).toBeNull();
  });

  it('scales note loudness with the volume', () => {
    const context = new FakeAudioContext();
    const player = new WebAudioPitchPlayer(contextFactory(context), { gain: 0.4 });

    player.setVolume(0.5);
    player.play(60, 1);

    // Half the slider is a quarter of the gain: 0.4 * 0.5 * 0.5 = 0.1.
    const peak = context.gains[0]?.gain.ramps.find((ramp) => ramp.value > 0.001)?.value ?? 0;
    expect(peak).toBeCloseTo(0.1, 6);
    expect(player.volume).toBe(0.5);
  });

  it('plays nothing at all at zero volume', () => {
    const context = new FakeAudioContext();
    const player = new WebAudioPitchPlayer(contextFactory(context));

    player.setVolume(0);
    player.play(60, 1);

    expect(context.oscillators).toHaveLength(0);
  });

  it('clamps volumes from outside the slider range', () => {
    const player = new WebAudioPitchPlayer(contextFactory(new FakeAudioContext()));

    player.setVolume(5);
    expect(player.volume).toBe(1);
    player.setVolume(-2);
    expect(player.volume).toBe(0);
  });

  it('releases everything on demand and ignores unknown notes', () => {
    const context = new FakeAudioContext();
    const player = new WebAudioPitchPlayer(contextFactory(context));

    player.stop(60);
    player.play(60, 0.5);
    player.play(64, 0.5);
    player.stopAll();

    expect(context.oscillators.every((node) => node.stoppedAt !== null)).toBe(true);
  });
});

describe('when the click is actually heard', () => {
  it('stamps a tick with that moment, not with the moment it was queued', () => {
    // What `MetronomeTick.scheduledTimeMs` has always promised, and what it
    // never delivered: `currentTime` is the frame the context is processing,
    // and a buffer's worth of audio still lies between it and the speaker.
    //
    // It matters because a reader plays to the click. Judged against a beat
    // that had not been heard yet, playing perfectly in time reads as playing
    // late - by exactly this much, on every note.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const context = new FakeAudioContext();
    context.outputLatency = 0.08;
    const metronome = new WebAudioMetronome(contextFactory(context), {
      schedulerIntervalMs: 20,
      scheduleAheadSec: 0.12,
    });
    metronome.configure({
      bpm: 60,
      timeSignature: new TimeSignature(4, 4),
      subdivisionsPerPulse: 1,
      click: 'pulse',
      dropout: null,
      muted: true,
    });
    const heard: MetronomeTick[] = [];
    metronome.onTick((tick) => heard.push(tick));

    metronome.start();
    context.advance(0.1);
    vi.advanceTimersByTime(120);

    const [first] = heard;
    expect(first).toBeDefined();
    // Queued 60 ms in, heard 80 ms after that.
    expect(first?.scheduledTimeMs).toBeCloseTo(60 + 80, 3);
    vi.useRealTimers();
  });

  it('says nothing extra when the device reports no delay', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const context = new FakeAudioContext();
    const metronome = new WebAudioMetronome(contextFactory(context), {
      schedulerIntervalMs: 20,
      scheduleAheadSec: 0.12,
    });
    metronome.configure({
      bpm: 60,
      timeSignature: new TimeSignature(4, 4),
      subdivisionsPerPulse: 1,
      click: 'pulse',
      dropout: null,
      muted: true,
    });
    const heard: MetronomeTick[] = [];
    metronome.onTick((tick) => heard.push(tick));

    metronome.start();
    context.advance(0.1);
    vi.advanceTimersByTime(120);

    expect(heard[0]?.scheduledTimeMs).toBeCloseTo(60, 3);
    vi.useRealTimers();
  });
});
