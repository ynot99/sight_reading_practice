import { describe, expect, it } from 'vitest';
import { PerformanceRecorder } from '../../src/application/PerformanceRecorder.js';
import { type TakeShelf, TakeLibrary } from '../../src/application/TakeLibrary.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';

interface Rig {
  readonly clock: ManualClock;
  readonly midi: MockMidiAdapter;
  readonly recorder: PerformanceRecorder;
}

function rig(options: { silenceMs?: number; capacity?: number } = {}): Rig {
  const clock = new ManualClock();
  const midi = new MockMidiAdapter({ clock });
  const recorder = new PerformanceRecorder(clock, options);
  recorder.listenTo(midi);
  return { clock, midi, recorder };
}

/** Plays one note, holding it for `holdMs`, and leaves the clock at the end. */
function playNote(harness: Rig, midi: number, holdMs = 100): void {
  harness.midi.noteOn(midi, harness.clock.now());
  harness.clock.advance(holdMs);
  harness.midi.noteOff(midi, harness.clock.now());
}

describe('a stretch of playing ending', () => {
  it('is announced once, however many messages arrive after the silence', () => {
    // The bug: a knob being turned sends a stream of control messages, none
    // of which is playing and none of which the recorder keeps - so each one
    // arrived after the same silence and closed the same take again. The
    // reader found the same recording in the list two or three times.
    const harness = rig({ silenceMs: 1_000 });
    const closed: number[] = [];
    harness.recorder.events.on('takeClosed', ({ take }) => closed.push(take.noteCount));

    playNote(harness, 60);
    harness.clock.advance(5_000);
    for (let message = 0; message < 4; message += 1) {
      harness.midi.control(7, message / 4, harness.clock.now());
    }

    expect(closed).toEqual([1]);
  });

  it('is announced again once there is something new to end', () => {
    const harness = rig({ silenceMs: 1_000 });
    const closed: number[] = [];
    harness.recorder.events.on('takeClosed', ({ take }) => closed.push(take.noteCount));

    playNote(harness, 60);
    harness.clock.advance(5_000);
    playNote(harness, 62);
    harness.clock.advance(5_000);
    playNote(harness, 64);

    expect(closed).toEqual([1, 1]);
  });
});

describe('keeping what was just played', () => {
  it('is already recording, with nothing switched on', () => {
    // The whole design: an idea worth keeping is noticed after it is played,
    // so a Record button would arrive after the thing it was for.
    const harness = rig();
    playNote(harness, 60);

    expect(harness.recorder.take()?.noteCount).toBe(1);
  });

  it('offers nothing when nothing has been played', () => {
    expect(rig().recorder.take()).toBeNull();
  });

  it('starts the take at the first note, not at the page opening', () => {
    const harness = rig();
    harness.clock.advance(600_000);
    playNote(harness, 60);

    const take = harness.recorder.take();
    expect(take?.events[0]?.atMs).toBe(0);
    // Ten minutes of nothing would otherwise be ten minutes of file.
    expect(take?.durationMs).toBe(100);
  });

  it('cuts the take at the last long silence', () => {
    const harness = rig({ silenceMs: 4_000 });
    playNote(harness, 60);
    harness.clock.advance(10_000);
    playNote(harness, 64);
    harness.clock.advance(200);
    playNote(harness, 67);

    // Practising, then a pause, then the idea: only the idea is kept.
    const take = harness.recorder.take();
    expect(take?.noteCount).toBe(2);
    expect(take?.events.map((event) => ('midi' in event ? event.midi : -1))).toEqual([
      64, 64, 67, 67,
    ]);
  });

  it('holds a phrase together across a pause inside it', () => {
    const harness = rig({ silenceMs: 4_000 });
    playNote(harness, 60);
    harness.clock.advance(1_500);
    playNote(harness, 64);

    expect(harness.recorder.take()?.noteCount).toBe(2);
  });

  it('releases a key still down when the take ends', () => {
    const harness = rig();
    harness.midi.noteOn(60, harness.clock.now());
    harness.clock.advance(300);

    // A note-on whose note-off never comes is a note that rings for ever in
    // whatever opens the file.
    const take = harness.recorder.take();
    expect(take?.events.filter((event) => event.kind === 'noteOff')).toHaveLength(1);
  });

  it('keeps the sustain pedal, which is half of how a piano sounds', () => {
    const harness = rig();
    harness.midi.pedal(true, harness.clock.now());
    playNote(harness, 60);

    expect(harness.recorder.take()?.events.some((event) => event.kind === 'sustain')).toBe(true);
  });

  it('forgets the oldest rather than growing all day', () => {
    const harness = rig({ capacity: 4 });
    for (let note = 0; note < 6; note += 1) {
      playNote(harness, 60 + note, 10);
      harness.clock.advance(10);
    }

    expect(harness.recorder.pendingEvents).toBe(4);
  });

  it('says how long the take on offer is', () => {
    const harness = rig();
    playNote(harness, 60, 250);

    expect(harness.recorder.takeDurationMs).toBe(250);
    harness.recorder.clear();
    expect(harness.recorder.takeDurationMs).toBe(0);
  });

  it('stops listening when told to', () => {
    const harness = rig();
    harness.recorder.stop();
    playNote(harness, 60);

    expect(harness.recorder.take()).toBeNull();
  });
});

describe('the takes that were kept', () => {
  function keptTake(library: TakeLibrary, at = 1_000) {
    return fileTake(library, at, 'kept');
  }

  function fileTake(library: TakeLibrary, at = 1_000, shelf: TakeShelf = 'kept') {
    const harness = rig();
    playNote(harness, 60);
    const take = harness.recorder.take();
    if (take === null) {
      throw new Error('expected a take');
    }
    return library.file(take, at, shelf);
  }

  it('survives the visit that kept them', () => {
    const store = new InMemorySettingsStore();
    const first = new TakeLibrary(store);
    keptTake(first);

    const next = new TakeLibrary(store);
    next.load();

    expect(next.list()).toHaveLength(1);
    expect(next.list()[0]?.noteCount).toBe(1);
  });

  it('keeps the events, so the file is derived and not stored', () => {
    const store = new InMemorySettingsStore();
    const library = new TakeLibrary(store);
    const kept = keptTake(library);

    const next = new TakeLibrary(store);
    next.load();
    const restored = next.find(kept.id);

    // The performance is the kept thing; a stored file could not be re-cut,
    // re-tempoed or re-exported, and would be a second source of truth.
    expect(restored?.events.map((event) => event.kind)).toEqual(['noteOn', 'noteOff']);
    expect(restored?.events[0]?.kind === 'noteOn' ? restored.events[0].velocity : 0).toBeCloseTo(
      0.8,
      1,
    );
  });

  it('puts the newest first', () => {
    const library = new TakeLibrary(new InMemorySettingsStore());
    keptTake(library, 1_000);
    keptTake(library, 5_000);

    expect(library.list()[0]?.savedAtMs).toBe(5_000);
  });

  it('deletes one without touching the others', () => {
    const library = new TakeLibrary(new InMemorySettingsStore());
    const first = keptTake(library, 1_000);
    keptTake(library, 2_000);

    library.remove(first.id);

    expect(library.list()).toHaveLength(1);
    expect(library.find(first.id)).toBeNull();
  });

  it('keeps two takes filed in the same millisecond as two takes', () => {
    // Ids are minted from the clock and the clock is coarser than the reader:
    // a keep followed at once by the take that closed behind it lands on the
    // same millisecond, and the second used to replace the first. It failed
    // where it matters least - on a loaded machine rather than at the desk.
    const library = new TakeLibrary(new InMemorySettingsStore());
    keptTake(library, 1_000);
    keptTake(library, 1_000);

    expect(library.list()).toHaveLength(2);
    expect(new Set(library.list().map((take) => take.id)).size).toBe(2);
  });

  it('drops the oldest of what it filed by itself', () => {
    const library = new TakeLibrary(new InMemorySettingsStore(), 2);
    fileTake(library, 1_000, 'recent');
    fileTake(library, 2_000, 'recent');
    fileTake(library, 3_000, 'recent');

    expect(library.list().map((take) => take.savedAtMs)).toEqual([3_000, 2_000]);
  });

  it('never drops what the reader asked to keep', () => {
    // The one thing here that was chosen. A library that quietly threw those
    // away would be worse than no library: the reader finds out by looking
    // for something that has gone.
    const library = new TakeLibrary(new InMemorySettingsStore(), 1);
    keptTake(library, 1_000);
    keptTake(library, 2_000);
    fileTake(library, 3_000, 'recent');
    fileTake(library, 4_000, 'recent');

    expect(library.list().map((take) => take.savedAtMs)).toEqual([4_000, 2_000, 1_000]);
  });

  it('moves one off the shelf that prunes', () => {
    const library = new TakeLibrary(new InMemorySettingsStore(), 1);
    const filed = fileTake(library, 1_000, 'recent');

    library.setShelf(filed.id, 'kept');
    fileTake(library, 2_000, 'recent');
    fileTake(library, 3_000, 'recent');

    expect(library.find(filed.id)?.shelf).toBe('kept');
    expect(library.list().map((take) => take.savedAtMs)).toEqual([3_000, 1_000]);
  });

  it('forgets everything when asked', () => {
    const store = new InMemorySettingsStore();
    const library = new TakeLibrary(store);
    keptTake(library);

    library.forget();

    expect(library.isEmpty).toBe(true);
    expect(store.read()).toBeNull();
  });

  it('ignores anything stored that no longer parses', () => {
    const store = new InMemorySettingsStore();
    store.write({ version: 1, takes: ['nonsense', { id: 5 }, { id: 'x', savedAtMs: 1 }] });
    const library = new TakeLibrary(store);

    library.load();

    // A hand-edited value costs the take, not the app.
    expect(library.list()).toHaveLength(0);
  });
});
