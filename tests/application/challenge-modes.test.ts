import { describe, expect, it } from 'vitest';
import type { PracticeSettings } from '../../src/application/PracticeController.js';
import { BAR_MODE_ID } from '../../src/application/modes/BarMode.js';
import {
  CHALLENGE_MODES,
  modesOn,
  settingsForFrame,
  settingsForMode,
} from '../../src/application/modes/challengeModes.js';
import { FLOW_MODE_ID } from '../../src/application/modes/FlowMode.js';
import { LISTEN_MODE_ID } from '../../src/application/modes/ListenFrame.js';
import { NOTE_MODE_ID } from '../../src/application/modes/NoteMode.js';
import { WAIT_MODE_ID } from '../../src/application/modes/WaitMode.js';

/**
 * As much of the settings as the squares and the frames read.
 *
 * Every square off and the plain frame, unless the test says otherwise.
 */
function settings(overrides: Partial<PracticeSettings> = {}): PracticeSettings {
  return {
    modeId: FLOW_MODE_ID,
    survival: false,
    readAheadSteps: null,
    rhythmOnly: false,
    stopAtAMistake: false,
    cursorWhileRunning: true,
    ...overrides,
  } as unknown as PracticeSettings;
}

/** The settings once a change has been written over them. */
function after(from: PracticeSettings, change: Partial<PracticeSettings>): PracticeSettings {
  return { ...from, ...change };
}

/** Every square on, which only a frame where the reader plays allows. */
const EVERYTHING_ON = settings({
  survival: true,
  readAheadSteps: 1,
  rhythmOnly: true,
  cursorWhileRunning: false,
});

describe('the frames, one at a time', () => {
  it('chooses a frame, and puts the one lit before out', () => {
    expect(settingsForFrame(BAR_MODE_ID, settings({ modeId: NOTE_MODE_ID })).modeId).toBe(BAR_MODE_ID);
  });

  it('goes back to flowing in time when the lit one is pressed again', () => {
    expect(settingsForFrame(NOTE_MODE_ID, settings({ modeId: NOTE_MODE_ID })).modeId).toBe(FLOW_MODE_ID);
  });

  it('puts out every square where the machine plays', () => {
    const now = after(EVERYTHING_ON, settingsForFrame(LISTEN_MODE_ID, EVERYTHING_ON));

    expect(now.modeId).toBe(LISTEN_MODE_ID);
    expect(modesOn(now)).toEqual([]);
  });

  it('puts out only rhythm where the music waits with no beat', () => {
    const now = after(EVERYTHING_ON, settingsForFrame(WAIT_MODE_ID, EVERYTHING_ON));

    expect(now.modeId).toBe(WAIT_MODE_ID);
    expect(modesOn(now)).toEqual(['survival', 'blind', 'cursor']);
  });

  it('puts nothing out where the beat still runs', () => {
    for (const frame of [BAR_MODE_ID, NOTE_MODE_ID]) {
      const now = after(EVERYTHING_ON, settingsForFrame(frame, EVERYTHING_ON));

      expect(modesOn(now)).toEqual(modesOn(EVERYTHING_ON));
    }
  });
});

describe('a square turned on in a frame it cannot go with', () => {
  it('takes the reader back to flowing in time, any square where the machine plays', () => {
    for (const mode of CHALLENGE_MODES) {
      const change = settingsForMode(mode, true, settings({ modeId: LISTEN_MODE_ID }));

      expect(change.modeId).toBe(FLOW_MODE_ID);
    }
  });

  it('takes rhythm, and only rhythm, out of the frame that waits with no beat', () => {
    const waiting = settings({ modeId: WAIT_MODE_ID });

    expect(settingsForMode('rhythm', true, waiting).modeId).toBe(FLOW_MODE_ID);
    for (const mode of CHALLENGE_MODES.filter((mode) => mode !== 'rhythm')) {
      expect(settingsForMode(mode, true, waiting).modeId).toBeUndefined();
    }
  });

  it('leaves the frame alone when a square is turned off', () => {
    expect(settingsForMode('survival', false, settings({ modeId: LISTEN_MODE_ID })).modeId).toBeUndefined();
  });
});
