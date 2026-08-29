import { describe, expect, it } from 'vitest';
import { HealthMeter } from '../../src/domain/scoring/HealthMeter.js';

describe('the bar that drains while the music runs', () => {
  it('starts full', () => {
    expect(new HealthMeter().health).toBe(1);
  });

  it('falls with musical time, not with the clock', () => {
    // The whole of how this survives a slow piece: a beat at 50 bpm lasts
    // more than twice as long as one at 120, so the same fall takes more than
    // twice as long on screen without anything being told the tempo.
    const meter = new HealthMeter({ drainPerBeat: 0.1 });

    expect(meter.drainForBeats(1)).toBeCloseTo(0.9, 10);
    expect(meter.drainForBeats(2)).toBeCloseTo(0.7, 10);
  });

  it('drains by the same amount for the same music, whatever its tempo', () => {
    const slow = new HealthMeter({ drainPerBeat: 0.1 });
    const fast = new HealthMeter({ drainPerBeat: 0.1 });

    // Four beats of music is four beats of music.
    slow.drainForBeats(4);
    for (let beat = 0; beat < 4; beat += 1) {
      fast.drainForBeats(1);
    }

    expect(slow.health).toBeCloseTo(fast.health, 10);
  });

  it('rises for a step played correctly', () => {
    const meter = new HealthMeter({ drainPerBeat: 0.1, rewardPerStep: 0.2 });
    meter.drainForBeats(3);

    expect(meter.settle('correct')).toBeCloseTo(0.9, 10);
  });

  it('gives back more than a beat costs, or nothing could be survived', () => {
    // Perfect playing must climb. A reward below the drain would make the
    // game unwinnable by construction rather than by difficulty.
    const meter = new HealthMeter();
    meter.drainForBeats(4);
    const before = meter.health;
    meter.drainForBeats(1);
    meter.settle('correct');

    expect(meter.health).toBeGreaterThan(before);
  });

  it('costs most for a step the music took away', () => {
    const missed = new HealthMeter();
    const wrong = new HealthMeter();

    missed.settle('missed');
    wrong.settle('incorrect');

    expect(missed.health).toBeLessThan(wrong.health);
    expect(wrong.health).toBeLessThan(1);
  });

  it('neither pays nor punishes for a rest', () => {
    const meter = new HealthMeter();
    meter.drainForBeats(2);
    const before = meter.health;

    // Paying for silence would let a piece full of rests carry the reader;
    // the drain still runs through it, so a long rest is not a place to stand.
    expect(meter.settle('skipped')).toBe(before);
  });

  it('never leaves nought and one', () => {
    const meter = new HealthMeter({ drainPerBeat: 5 });
    expect(meter.drainForBeats(1)).toBe(0);
    expect(meter.isEmpty).toBe(true);

    meter.reset();
    for (let at = 0; at < 50; at += 1) {
      meter.settle('correct');
    }
    expect(meter.health).toBe(1);
  });

  it('ignores time that did not pass', () => {
    const meter = new HealthMeter();
    // A tick at the same musical position as the last one, which is what a
    // restart looks like from here.
    expect(meter.drainForBeats(0)).toBe(1);
    expect(meter.drainForBeats(-4)).toBe(1);
  });

  it('starts over when the run does', () => {
    const meter = new HealthMeter();
    meter.settle('missed');
    meter.reset();

    expect(meter.health).toBe(1);
  });
});
