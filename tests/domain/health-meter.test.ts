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

  it('rises for a step played correctly, by what the step was worth', () => {
    const meter = new HealthMeter({ drainPerBeat: 0.1, rewardPerBeat: 0.2 });
    meter.drainForBeats(3);

    expect(meter.settle('correct', 1)).toBeCloseTo(0.9, 10);
  });

  it('pays a bar the same whatever it is divided into', () => {
    // The unfairness this replaces: the reward was a flat amount per step, so
    // what a reader could earn was decided by how many notes the writer put in
    // the bar. Practising one hand through a passage of whole notes, there was
    // simply not enough to earn - the bar fell and nothing in reach could
    // stop it.
    // Drained well clear of full first: from the top, both would earn their
    // way to the ceiling and the ceiling would be what the test measured.
    const options = { drainPerBeat: 0.05, rewardPerBeat: 0.05 };
    const sparse = new HealthMeter(options);
    const busy = new HealthMeter(options);
    sparse.drainForBeats(10);
    busy.drainForBeats(10);

    // A bar of 4/4: one whole note, or sixteen sixteenths.
    sparse.settle('correct', 4);
    for (let sixteenth = 0; sixteenth < 16; sixteenth += 1) {
      busy.settle('correct', 0.25);
    }

    expect(sparse.health).toBeCloseTo(busy.health, 10);
    expect(sparse.health).toBeLessThan(1);
  });

  it('gives back more than a beat costs, or nothing could be survived', () => {
    // Perfect playing must climb. A reward below the drain would make the
    // game unwinnable by construction rather than by difficulty.
    const meter = new HealthMeter();
    meter.drainForBeats(4);
    const before = meter.health;
    meter.drainForBeats(1);
    meter.settle('correct', 1);

    expect(meter.health).toBeGreaterThan(before);
  });

  it('ranks the three ways a beat can go, over the whole beat', () => {
    // Measured across the drain and the settle together, because that is what
    // the reader sees: the settle alone is only half the accounting, and a
    // wrong note repays the time it kept up with before it is charged for.
    function overOneBeat(status: 'correct' | 'incorrect' | 'missed'): number {
      const meter = new HealthMeter();
      meter.drainForBeats(10);
      const before = meter.health;
      meter.drainForBeats(1);
      meter.settle(status, 1);
      return meter.health - before;
    }

    expect(overOneBeat('correct')).toBeGreaterThan(0);
    // A wrong note loses what a right one would have gained.
    expect(overOneBeat('incorrect')).toBeCloseTo(-overOneBeat('correct'), 10);
    expect(overOneBeat('missed')).toBeLessThan(overOneBeat('incorrect'));
  });

  it('gives a rest its own time back, so nothing is lost by observing it', () => {
    // Nothing was asked here, so nothing can be failed. The bar used to fall
    // straight through a rest, which reads as fair until the reader is
    // practising one hand: whole passages then belong to the other, and they
    // were being drained for correctly playing nothing, with no note in reach
    // to earn it back.
    const meter = new HealthMeter({ drainPerBeat: 0.1 });
    meter.drainForBeats(4);
    const before = meter.health;

    meter.drainForBeats(2);
    expect(meter.settle('skipped', 2)).toBeCloseTo(before, 10);
  });

  it('holds level through a piece that asks nothing of this hand at all', () => {
    // The complaint, at full length: eight bars where the other hand has the
    // music. The reader plays exactly right by playing nothing, and must
    // arrive at the end with the bar where it started.
    const meter = new HealthMeter();

    for (let bar = 0; bar < 8; bar += 1) {
      meter.drainForBeats(4);
      meter.settle('skipped', 4);
    }

    expect(meter.health).toBeCloseTo(1, 10);
    expect(meter.isEmpty).toBe(false);
  });

  it('never leaves nought and one', () => {
    const meter = new HealthMeter({ drainPerBeat: 5 });
    expect(meter.drainForBeats(1)).toBe(0);
    expect(meter.isEmpty).toBe(true);

    meter.reset();
    for (let at = 0; at < 50; at += 1) {
      meter.settle('correct', 1);
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

  it('gives back the share of the bar a beat was said to be worth', () => {
    // His. Filling it outright makes a clock that punishes stopping and
    // nothing else: find one beat and the bar is full again however long the
    // last one took. A share asks the reader to keep finding them.
    const meter = new HealthMeter({ drainPerSecond: 0.1 });
    meter.drainForSeconds(6);
    expect(meter.health).toBeCloseTo(0.4, 5);

    meter.refill(0.3);

    expect(meter.health).toBeCloseTo(0.7, 5);
  });

  it('fills it outright when that is what a beat is worth', () => {
    // Which is where this started, and still the default.
    const meter = new HealthMeter({ drainPerSecond: 0.1 });
    meter.drainForSeconds(9);

    expect(meter.refill()).toBe(1);
  });

  it('charges for the wrong notes a beat was found through, where asked', () => {
    // The hole he named: a beat found through five wrong notes filled the bar
    // exactly as a clean one did, so in that mode nothing was ever survived.
    // Found is found, so it is still paid for - the wrong notes cost on top,
    // exactly as they do when the music keeps its own time.
    const clean = new HealthMeter({ drainPerSecond: 0.1, wrongPenalty: 0.05 });
    const hunted = new HealthMeter({ drainPerSecond: 0.1, wrongPenalty: 0.05 });
    clean.drainForSeconds(6);
    hunted.drainForSeconds(6);

    clean.refill(0.3, true);
    hunted.refill(0.3, false);

    expect(clean.health).toBeCloseTo(0.7, 5);
    expect(hunted.health).toBeCloseTo(0.65, 5);
  });

  it('starts over when the run does', () => {
    const meter = new HealthMeter();
    meter.settle('missed', 1);
    meter.reset();

    expect(meter.health).toBe(1);
  });
});
