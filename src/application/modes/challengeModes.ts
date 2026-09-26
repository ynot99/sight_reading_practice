import type { PracticeSettings } from '../PracticeController.js';
import { FLOW_MODE_ID } from './FlowMode.js';
import { LISTEN_MODE_ID } from './ListenFrame.js';
import { WAIT_MODE_ID } from './WaitMode.js';

/** The squares a reader can turn on, in the order they are shown. */
export const CHALLENGE_MODES: readonly string[] = ['survival', 'blind', 'rhythm', 'strict', 'cursor'];

/**
 * What a mode square is, said once.
 *
 * Each is a setting that already exists, read and written through this rather
 * than duplicated by it: there is one answer to "am I playing survival", and
 * the square is another way of asking it. `blind` is the veil drawn over the
 * step under the reader's fingers, which is what makes it blind - the note is
 * gone by the time they reach it, so it has to have been read already.
 *
 * Here rather than in the view because a reading kept in the history says what
 * it was played with, and a second list of what "survival" means would be a
 * second answer to the same question.
 */
export function modeIsOn(mode: string, settings: PracticeSettings): boolean {
  switch (mode) {
    case 'survival':
      return settings.survival;
    case 'blind':
      return settings.readAheadSteps !== null && settings.readAheadSteps >= 1;
    case 'rhythm':
      return settings.rhythmOnly;
    case 'strict':
      return settings.stopAtAMistake;
    // Read the other way round, because the square is the challenge and the
    // setting is the comfort: on means the marker is gone and the reader is
    // keeping the place themselves.
    case 'cursor':
      return !settings.cursorWhileRunning;
    default:
      return false;
  }
}

/** The squares that are on, by name. */
export function modesOn(settings: PracticeSettings): readonly string[] {
  return CHALLENGE_MODES.filter((mode) => modeIsOn(mode, settings));
}

/**
 * The frames a square cannot be played in.
 *
 * Choosing one of the two turns the other off, whichever was chosen last - his,
 * after the mods of a rhythm game, where each button knows what it cannot go
 * with and the other simply goes out. Listening asks nothing of the reader, so
 * nothing that makes the reading harder has anything to act on there. And
 * rhythm only asks for the time between notes, which the frame that waits for
 * the reader never keeps.
 */
const FRAMES_A_SQUARE_REFUSES: Readonly<Record<string, readonly string[]>> = {
  survival: [LISTEN_MODE_ID],
  blind: [LISTEN_MODE_ID],
  rhythm: [LISTEN_MODE_ID, WAIT_MODE_ID],
  strict: [LISTEN_MODE_ID],
  cursor: [LISTEN_MODE_ID],
};

/**
 * The settings a square writes when it is turned on or off.
 *
 * Turned on in a frame it cannot be played in, it takes the reader back to the
 * plain frame, flowing in time: the square is what was just asked for.
 */
export function settingsForMode(
  mode: string,
  on: boolean,
  settings: PracticeSettings,
): Partial<PracticeSettings> {
  const own = squareSettings(mode, on);
  if (!on || !(FRAMES_A_SQUARE_REFUSES[mode] ?? []).includes(settings.modeId)) {
    return own;
  }
  return { ...own, modeId: FLOW_MODE_ID };
}

/**
 * The settings pressing a frame's button writes.
 *
 * The frames are one question with one answer, so a button pressed chooses its
 * frame and the one lit before goes out; pressed again, it goes out itself and
 * leaves the plain frame, which has no button - it is what is left when none is
 * pressed. Any square the chosen frame cannot go with goes out too.
 */
export function settingsForFrame(
  frame: string,
  settings: PracticeSettings,
): Partial<PracticeSettings> {
  const chosen = settings.modeId === frame ? FLOW_MODE_ID : frame;
  const refused = CHALLENGE_MODES.filter(
    (mode) => modeIsOn(mode, settings) && (FRAMES_A_SQUARE_REFUSES[mode] ?? []).includes(chosen),
  );
  return Object.assign(
    { modeId: chosen },
    ...refused.map((mode) => squareSettings(mode, false)),
  ) as Partial<PracticeSettings>;
}

function squareSettings(mode: string, on: boolean): Partial<PracticeSettings> {
  switch (mode) {
    case 'survival':
      return { survival: on };
    case 'blind':
      return { readAheadSteps: on ? 1 : null };
    // Each of these empties the other, so each turns the other off - "one
    // wrong note ends the run" and "any note counts" cannot both be the
    // answer. His: both squares answer, rather than one of them refusing.
    // Turning either *off* leaves the other alone: it was already off.
    case 'rhythm':
      return on ? { rhythmOnly: true, stopAtAMistake: false } : { rhythmOnly: false };
    case 'strict':
      return on ? { stopAtAMistake: true, rhythmOnly: false } : { stopAtAMistake: false };
    case 'cursor':
      return { cursorWhileRunning: !on };
    default:
      return {};
  }
}
