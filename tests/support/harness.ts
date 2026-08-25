import type { IPracticeMode } from '../../src/application/modes/IPracticeMode.js';
import type { SessionOptions } from '../../src/application/session/PracticeContext.js';
import { PracticeSession } from '../../src/application/session/PracticeSession.js';
import type { SessionEventMap } from '../../src/application/session/SessionEvents.js';
import type { IScoringStrategy } from '../../src/domain/scoring/IScoringStrategy.js';
import { AccuracyScoringStrategy } from '../../src/domain/scoring/strategies.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { buildTimeline, type ExerciseTimeline } from '../../src/domain/timeline/Timeline.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';

export type RecordedEvent = {
  [K in keyof SessionEventMap]: { type: K; payload: SessionEventMap[K] };
}[keyof SessionEventMap];

export interface Harness {
  readonly clock: ManualClock;
  readonly midi: MockMidiAdapter;
  readonly metronome: ManualMetronome;
  readonly timeline: ExerciseTimeline;
  readonly session: PracticeSession;
  readonly events: RecordedEvent[];
  /** Events of one kind, in order. */
  of<K extends keyof SessionEventMap>(type: K): SessionEventMap[K][];
}

export interface HarnessOptions {
  readonly exercise: Exercise;
  readonly mode: IPracticeMode;
  readonly options?: Partial<SessionOptions>;
  readonly scoring?: IScoringStrategy;
  readonly startAtMs?: number;
}

/**
 * Assembles a complete practice session from test doubles.
 *
 * Every port is substituted, so the run is deterministic and instantaneous
 * while the production code under test is exactly the code that ships.
 */
export function createHarness(config: HarnessOptions): Harness {
  const clock = new ManualClock(config.startAtMs ?? 0);
  const midi = new MockMidiAdapter({ clock });
  const metronome = new ManualMetronome(clock);
  const timeline = buildTimeline(config.exercise);

  const session = new PracticeSession({
    timeline,
    mode: config.mode,
    midi,
    metronome,
    clock,
    scoring: config.scoring ?? new AccuracyScoringStrategy(),
    options: config.options,
  });

  const events: RecordedEvent[] = [];
  const record = <K extends keyof SessionEventMap>(type: K): void => {
    session.events.on(type, (payload) => {
      events.push({ type, payload } as RecordedEvent);
    });
  };
  record('statusChanged');
  record('countIn');
  record('stepEntered');
  record('stepCompleted');
  record('noteJudged');
  record('beat');
  record('finished');

  return {
    clock,
    midi,
    metronome,
    timeline,
    session,
    events,
    of<K extends keyof SessionEventMap>(type: K): SessionEventMap[K][] {
      const payloads: SessionEventMap[K][] = [];
      for (const event of events) {
        if (event.type === type) {
          payloads.push(event.payload as SessionEventMap[K]);
        }
      }
      return payloads;
    },
  };
}
