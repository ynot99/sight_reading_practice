import { describe, expect, it, vi } from 'vitest';
import { ControlBinding } from '../../src/application/ControlBinding.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';

function rig() {
  const clock = new ManualClock();
  const midi = new MockMidiAdapter({ clock });
  const binding = new ControlBinding();
  binding.listenTo(midi);
  const moves: number[] = [];
  binding.events.on('moved', ({ value }) => moves.push(value));
  return { midi, binding, moves };
}

/** Turns a knob through several positions, as a hand does. */
function turn(harness: ReturnType<typeof rig>, controller: number, count = 3): void {
  for (let at = 0; at < count; at += 1) {
    harness.midi.control(controller, at / 10);
  }
}

describe('teaching the app which knob to follow', () => {
  it('follows nothing until it has been taught', () => {
    const harness = rig();
    turn(harness, 7);

    // No table of controller numbers could be right for every keyboard, so
    // nothing is assumed on the reader's behalf.
    expect(harness.binding.controller).toBeNull();
    expect(harness.moves).toEqual([]);
  });

  it('learns the knob that was turned', () => {
    const harness = rig();
    harness.binding.learn();
    turn(harness, 11);

    expect(harness.binding.controller).toBe(11);
    expect(harness.binding.isLearning).toBe(false);
  });

  it('waits for a knob to move, not merely to speak', () => {
    const harness = rig();
    harness.binding.learn();

    // A keyboard announces bank selects and modes on connect. Learned from
    // one message, the binding would take the first of those and then follow
    // something that never moves again.
    harness.midi.control(0, 0);
    harness.midi.control(0, 0);
    harness.midi.control(0, 0);

    expect(harness.binding.controller).toBeNull();
    expect(harness.binding.isLearning).toBe(true);
  });

  it('acts on the turn that taught it', () => {
    const harness = rig();
    harness.binding.learn();
    turn(harness, 7);

    // Otherwise the reader turns the knob, nothing happens, and they have to
    // turn it again to find out whether it worked.
    expect(harness.moves).toHaveLength(1);
  });

  it('follows the knob afterwards, and only that one', () => {
    const harness = rig();
    harness.binding.learn();
    turn(harness, 7);
    harness.moves.length = 0;

    harness.midi.control(7, 0.5);
    harness.midi.control(1, 0.9);

    expect(harness.moves).toEqual([0.5]);
  });

  it('is told what an earlier visit taught, without asking again', () => {
    const harness = rig();
    harness.binding.bindTo(11);

    harness.midi.control(11, 0.25);

    expect(harness.moves).toEqual([0.25]);
  });

  it('says when it learns, so the choice can be remembered', () => {
    const harness = rig();
    const learned = vi.fn();
    harness.binding.events.on('learned', learned);

    harness.binding.learn();
    turn(harness, 7);

    expect(learned).toHaveBeenCalledWith({ controller: 7 });
  });

  it('gives the knob back, sliders in charge again', () => {
    const harness = rig();
    const learned = vi.fn();
    harness.binding.bindTo(7);
    harness.binding.events.on('learned', learned);

    harness.binding.forget();
    harness.midi.control(7, 0.5);

    expect(harness.binding.controller).toBeNull();
    expect(harness.moves).toEqual([]);
    expect(learned).toHaveBeenCalledWith({ controller: null });
  });

  it('can be called off mid-learn, leaving what was bound', () => {
    const harness = rig();
    harness.binding.bindTo(7);
    harness.binding.learn();
    harness.midi.control(1, 0.1);

    harness.binding.cancelLearning();
    harness.midi.control(7, 0.5);

    // Cancelling is not forgetting: the knob that worked before still works.
    expect(harness.binding.controller).toBe(7);
    expect(harness.moves).toEqual([0.5]);
  });

  it('says whether it is waiting, so a button can show it', () => {
    const harness = rig();
    const listening: boolean[] = [];
    harness.binding.events.on('listeningChanged', ({ listening: value }) =>
      listening.push(value),
    );

    harness.binding.learn();
    harness.binding.cancelLearning();

    expect(listening).toEqual([true, false]);
  });

  it('is deaf to notes and to the pedal', () => {
    const harness = rig();
    harness.binding.learn();
    harness.midi.noteOn(60, 0);
    harness.midi.pedal(true, 1);
    harness.midi.pedal(false, 2);

    // Sustain is a pedal the app already sounds; learning it as a volume
    // knob would take the damper away and turn the piano down instead.
    expect(harness.binding.controller).toBeNull();
  });

  it('reports what it hears while learning, learned or not', () => {
    const harness = rig();
    const heard: { controller: number; positions: number }[] = [];
    harness.binding.events.on('heard', ({ controller, positions }) =>
      heard.push({ controller, positions }),
    );

    harness.binding.learn();
    harness.midi.control(1, 0.1);
    harness.midi.control(1, 0.2);

    // Without this the reader cannot tell "I turned the wrong thing" from
    // "this knob sends nothing", and some knobs really are analogue.
    expect(heard).toEqual([
      { controller: 1, positions: 1 },
      { controller: 1, positions: 2 },
    ]);
  });

  it('says nothing when nothing is arriving', () => {
    const harness = rig();
    const heard = vi.fn();
    harness.binding.events.on('heard', heard);

    harness.binding.learn();
    harness.midi.noteOn(60, 0);

    // Silence on the status line is the answer: the keyboard is not sending.
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops listening when disposed', () => {
    const harness = rig();
    harness.binding.bindTo(7);
    harness.binding.dispose();

    harness.midi.control(7, 0.5);

    expect(harness.moves).toEqual([]);
  });
});
