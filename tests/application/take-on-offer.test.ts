import { describe, expect, it } from 'vitest';
import { PerformanceRecorder } from '../../src/application/PerformanceRecorder.js';
import { TakeLibrary } from '../../src/application/TakeLibrary.js';
import { TakeOnOffer } from '../../src/application/TakeOnOffer.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';

const SILENCE_MS = 1_000;

function rig(): {
  readonly clock: ManualClock;
  readonly midi: MockMidiAdapter;
  readonly recorder: PerformanceRecorder;
  readonly takes: TakeLibrary;
  readonly offer: TakeOnOffer;
  readonly filed: string[];
} {
  const clock = new ManualClock();
  const midi = new MockMidiAdapter({ clock });
  const recorder = new PerformanceRecorder(clock, { silenceMs: SILENCE_MS });
  recorder.listenTo(midi);
  const takes = new TakeLibrary(new InMemorySettingsStore());
  let calendar = 1_000_000;
  const offer = new TakeOnOffer(recorder, takes, () => (calendar += 1));
  const filed: string[] = [];
  offer.events.on('filed', ({ take }) => filed.push(take.shelf));
  return { clock, midi, recorder, takes, offer, filed };
}

type Rig = ReturnType<typeof rig>;

/** Plays one note, holding it for `holdMs`, and leaves the clock at the end. */
function playNote(harness: Rig, midi: number, holdMs = 100): void {
  harness.midi.noteOn(midi, harness.clock.now());
  harness.clock.advance(holdMs);
  harness.midi.noteOff(midi, harness.clock.now());
}

const shelves = (harness: Rig): string[] => harness.takes.list().map((take) => take.shelf);

describe('the take on offer', () => {
  it('goes onto the recent shelf once the silence has ended it, and only once', () => {
    const harness = rig();
    playNote(harness, 60);
    playNote(harness, 62);

    // Still being played: nothing is filed yet.
    harness.clock.advance(SILENCE_MS - 200);
    expect(harness.offer.fileItIfItHasEnded()).toBeNull();
    expect(shelves(harness)).toEqual([]);

    harness.clock.advance(200);
    expect(harness.offer.fileItIfItHasEnded()?.noteCount).toBe(2);
    expect(harness.offer.fileItIfItHasEnded()).toBeNull();
    expect(shelves(harness)).toEqual(['recent']);
    expect(harness.filed).toEqual(['recent']);
    expect(harness.offer.isFiled).toBe(true);
    // And it is still on offer, for the button to go on showing.
    expect(harness.recorder.takeIsOnOffer).toBe(true);

    // The next key begins the next take and files nothing twice.
    playNote(harness, 64);
    expect(shelves(harness)).toEqual(['recent']);
    expect(harness.offer.isFiled).toBe(false);
  });

  it('keeps the take already on the list for good, rather than a second copy of it', () => {
    const harness = rig();
    playNote(harness, 60);
    harness.clock.advance(SILENCE_MS);
    const filed = harness.offer.fileItIfItHasEnded();

    const kept = harness.offer.keep();

    expect(kept?.id).toBe(filed?.id);
    expect(shelves(harness)).toEqual(['kept']);
    // Let go of, so the button cannot keep it again.
    expect(harness.recorder.takeIsOnOffer).toBe(false);
    expect(harness.offer.keep()).toBeNull();
    expect(shelves(harness)).toEqual(['kept']);
  });

  it('keeps a take still being played as it stands', () => {
    const harness = rig();
    playNote(harness, 60);

    expect(harness.offer.keep()?.shelf).toBe('kept');
    expect(shelves(harness)).toEqual(['kept']);
    expect(harness.filed).toEqual(['kept']);
    expect(harness.recorder.takeIsOnOffer).toBe(false);
  });

  it('files a take the page never said had ended when the next one begins', () => {
    const harness = rig();
    playNote(harness, 60);
    harness.clock.advance(SILENCE_MS);
    playNote(harness, 62);

    expect(shelves(harness)).toEqual(['recent']);
    expect(harness.filed).toEqual(['recent']);
  });

  it('files a second copy where the reader deleted the first from the list', () => {
    const harness = rig();
    playNote(harness, 60);
    harness.clock.advance(SILENCE_MS);
    const filed = harness.offer.fileItIfItHasEnded();
    harness.takes.remove(filed?.id ?? '');

    expect(harness.offer.isFiled).toBe(false);
    expect(harness.offer.keep()?.shelf).toBe('kept');
    expect(shelves(harness)).toEqual(['kept']);
  });
});
