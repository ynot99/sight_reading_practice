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
    expect(context.gains[0]?.gain.cancelled).toBe(1);
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
