import type { IPitchPlayer } from '../application/ports/IPitchPlayer.js';
import {
  theDynamicAt,
  theVelocityOfTheLevel,
  LOUDNESS_UNMARKED,
  type HeardBeat,
  type MidiFileEvent,
} from '../domain/midi/MidiFile.js';
import { isTypedInto, type TypedInto } from '../shared/typedInto.js';
import type { StoredSketch } from '../application/SketchLibrary.js';
import { HIGHEST_KEY, LOWEST_KEY } from './replayKeys.js';
import {
  rollAsEvents,
  rollBeganAtMs,
  rollEndedAtMs,
  rollOfTheTake,
  takeWithAKeyAdded,
  takeWithoutTheKeys,
  takeWithTheKeysChanged,
  takeWithTheKeysCopied,
  takeWithTheKeyCut,
  takeWithTheNotesPasted,
  takeWithThePedalAt,
  theChangeOnTheClipboard,
  theClipboardTextOf,
  theKeysOfTheTake,
  theNotesCopied,
  theNotesOnTheClipboard,
  type NoteCopied,
  type KeyChange,
  type KeyNamed,
  type KeyOfTheTake,
  type RolledPress,
  type RunRoll,
  theBeatNearest,
  theNextLineOfTheGrid,
  theEndNearest,
  theGridForANote,
  theStartNearest,
  theLineOfTheGridUnder,
  theEndAKeyFitsTo,
  aKeyIsOverAnotherOfItsPitch,
} from '../application/session/RunRoll.js';
import { theKeysInABox, type RollScene, type ScenePedal } from './rollView.js';
import { usesTheArrows } from './dom.js';
import type { AppView } from './AppView.js';

/** Whether two names are of one key: the same pitch, gone down at the same moment. */
export function sameKey(one: KeyNamed, other: KeyNamed): boolean {
  return one.midi === other.midi && one.downAtMs === other.downAtMs;
}

/** How near either end of a note the mouse or a finger takes hold of that end, in pixels. */
export const GRIP_PX = 10;

/** What of a note or a press of the pedal is taken hold of: the whole of it, moved, or one end, held longer or shorter. */
type Grip = 'whole' | 'start' | 'end';

/**
 * Which part of a stretch across the drawing a moment is on: an end, for
 * the last few pixels of it at either side - a third of one too short for
 * that, so the middle of it can still be moved - or the whole of it.
 */
export function theGripOfAStretch(fromMs: number, untilMs: number, atMs: number, pxPerMs: number): Grip {
  const edgePx = Math.min(GRIP_PX, ((untilMs - fromMs) * pxPerMs) / 3);
  if ((untilMs - atMs) * pxPerMs <= edgePx) {
    return 'end';
  }
  return (atMs - fromMs) * pxPerMs <= edgePx ? 'start' : 'whole';
}

/**
 * The pitch a press of the pedal is named by for a second tap on it: one no
 * key has, so two taps, one on a note and one on the pedal, are never a pair.
 */
const THE_PEDALS_ROW = -1;

/** The shortest a note can be held: shorter is a click rather than a note. */
const SHORTEST_NOTE_MS = 30;

/**
 * Beats of empty grid drawn past the end of a sketch: room for the next notes,
 * two bars of common time, and all of an empty sketch.
 */
export const ROOM_IN_A_SKETCH = 8;

/**
 * A sketch as it was before a change, to be put back: a change of metre or
 * pace moves its beats as well, and the notes chosen then are chosen again,
 * so an undone move leaves in hand what was being moved.
 */
export interface SketchAsItWas {
  readonly events: readonly MidiFileEvent[];
  readonly beats: readonly HeardBeat[];
  readonly chosen: readonly KeyNamed[];
}

/** A sketch kept as it is now, with the notes chosen on it, for an undo or a redo to come back to. */
export function asItWas(
  sketch: { readonly events: readonly MidiFileEvent[]; readonly beats: readonly HeardBeat[] },
  chosen: readonly KeyNamed[],
): SketchAsItWas {
  return { events: sketch.events, beats: sketch.beats, chosen };
}

/** The corner of a box a pointer is at, kept inside the notes it chooses among. */
function theBoxCornerAt(
  box: { readonly grid: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null },
  at: { readonly clientX: number; readonly clientY: number },
): { readonly clientX: number; readonly clientY: number } {
  const grid = box.grid;
  return grid === null
    ? at
    : {
        clientX: Math.min(grid.right, Math.max(grid.left, at.clientX)),
        clientY: Math.min(grid.bottom, Math.max(grid.top, at.clientY)),
      };
}

/**
 * Whether a press on a sketch adds to the notes chosen rather than choosing
 * alone: with Ctrl, Cmd or Shift held, as any editor has it. A finger chooses
 * several with the selection tool's box.
 */
function addsToTheChoice(event: PointerEvent): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

/** How loud a note written at a moment of a sketch is: as the flag over it says, and following it. */
export function theLoudnessWrittenAt(events: readonly MidiFileEvent[], atMs: number): number {
  return theVelocityOfTheLevel(theDynamicAt(events, atMs) ?? LOUDNESS_UNMARKED, 0);
}

/** How long a note moved up or down by an arrow key is heard for, at its new pitch. */
const HEARD_ON_A_STEP_MS = 300;

/** How long the key of a row is heard for when a tap finds the row empty: a moment, not the note a second tap would write. */
const HEARD_ON_A_TAP_MS = 300;

/**
 * The keys to strike for notes heard together: one for each pitch among them,
 * as hard as the hardest of that pitch. The instrument has one voice for a
 * pitch, so a second strike of it at once only cuts the first off and starts
 * it again.
 */
export function oneKeyForEachPitch(
  keys: readonly { readonly midi: number; readonly velocity: number }[],
): readonly { readonly midi: number; readonly velocity: number }[] {
  const hardest = new Map<number, number>();
  for (const { midi, velocity } of keys) {
    hardest.set(midi, Math.max(velocity, hardest.get(midi) ?? velocity));
  }
  return [...hardest].map(([midi, velocity]) => ({ midi, velocity }));
}

/**
 * How close two taps must come to be one double tap: as quick as the
 * double click a desktop counts, and as near as a finger lands twice.
 */
const DOUBLE_TAP_MS = 400;

const DOUBLE_TAP_PX = 12;

/**
 * How long a beat lasts where a moment falls, on a roll's beats: a note
 * written there is that long. Half a second where the roll has no beats.
 */
export function theBeatAt(roll: RunRoll, atMs: number): number {
  const beats = roll.beats;
  let at = 0;
  while (at + 1 < beats.length && (beats[at + 1]?.atMs ?? 0) <= atMs) {
    at += 1;
  }
  const here = beats[at]?.atMs;
  const next = beats[at + 1]?.atMs ?? null;
  const before = beats[at - 1]?.atMs ?? null;
  if (here !== undefined && next !== null) {
    return next - here;
  }
  return here !== undefined && before !== null ? here - before : 500;
}

/** How far a finger may wander and still be tapping, in pixels. */
export const TAP_SLOP_PX = 6;

/**
 * What the editing of a sketch asks of the view: the drawing shown and the
 * sketch in it, where things are on the screen, and painting it again.
 */
export type TheViewOfTheSketch = Pick<
  AppView,
  | 'boxOnTheViewer'
  | 'changeCopiedHere'
  | 'changeTheSketchShowing'
  | 'chooseTheMark'
  | 'chordsBeingForgotten'
  | 'copyTheMarkChosen'
  | 'doc'
  | 'drawTheRollInto'
  | 'drawnScene'
  | 'el'
  | 'isOnTheChords'
  | 'isOnThePedal'
  | 'isOnTheRuler'
  | 'lightTheSoundingRows'
  | 'markChosenAtMs'
  | 'notesCopiedHere'
  | 'paintTheRoll'
  | 'panned'
  | 'pasteTheChange'
  | 'putTheHeadAt'
  | 'putTheHeadWhereItWasTapped'
  | 'rollAtMs'
  | 'rollLook'
  | 'rollPlacedAtMs'
  | 'runtime'
  | 'sayWhatCanBeChanged'
  | 'sayWhetherThereIsAnythingToPaste'
  | 'showTheChordsOfTheKey'
  | 'takeTheMarkAway'
  | 'theGripOnTheSlice'
  | 'theKeyUnder'
  | 'theMomentUnder'
  | 'theOtherRollShowing'
  | 'thePointOnTheDrawing'
  | 'theRoll'
  | 'theRollsGrid'
  | 'theSceneToDraw'
  | 'theSketchAsDrawn'
>;

/**
 * What a pointer and the keys do to the notes of a sketch being edited:
 * choosing them, by a tap or a box; holding one and moving it, or
 * pulling an end; the pedal's lane; cutting, copying and pasting;
 * deleting; and putting a change back and bringing it back.
 *
 * Its own state is only what a gesture holds while it lasts. The drawing,
 * the sketch shown and how it is painted stay the view's, and are asked
 * of it through `TheViewOfTheSketch`.
 */
export class SketchEditing {
  private readonly host: TheViewOfTheSketch;

  /**
   * The chosen key of a recording held by a finger or the mouse: where it came
   * down, the drawing as it was then, and where the key has been moved to so
   * far, if anywhere.
   */
  rollDrag: {
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly scene: RollScene;
    /** The key it went down on. */
    readonly key: KeyNamed;
    /** Whether a tap on it adds it to the notes chosen or takes it out, rather than choosing it alone. */
    readonly adds: boolean;
    /**
     * Whether it is taken out of the notes chosen on letting go, where it was
     * not moved: with Ctrl on one already chosen, the press may be the start
     * of a copy of them all, and only a tap takes it out.
     */
    readonly letsGoOfIt: boolean;
    /** Whether a drag of the whole of it copies the keys it holds, leaving them where they were: Ctrl or Cmd held as it was pressed. */
    readonly copies: boolean;
    /** What of it was taken hold of: the whole note, moved, or one end, held longer or shorter. */
    readonly grip: Grip;
    /** When it was let go of, which a drag of its end moves. */
    readonly upAtMs: number;
    readonly moved: {
      readonly to: readonly KeyNamed[];
      readonly events: readonly MidiFileEvent[];
    } | null;
  } | null = null;
  /** The last tap on a sketch being edited, for the next to be its second. */
  private theLastTap: {
    readonly atMs: number;
    readonly clientX: number;
    readonly clientY: number;
    /** The note it was on, or nothing where it was on empty space. */
    readonly key: KeyNamed | null;
  } | null = null;
  /**
   * What sounds while a key of a sketch is held: every key the hold would
   * move, each at its own loudness, and how far up or down they have been
   * taken - so the ear follows the hand, chord and all.
   */
  private soundOfTheHeldKeys: {
    readonly keys: readonly { readonly midi: number; readonly velocity: number }[];
    readonly bySemitones: number;
  } | null = null;
  /** The box a mouse is drawing over a sketch being edited, to choose the notes inside it. */
  rollBoxDrawn: {
    readonly pointerId: number;
    /** Where it went down, on the screen. */
    readonly clientX: number;
    readonly clientY: number;
    /** Where the stage the box is placed in stood as it began. */
    readonly stageLeft: number;
    readonly stageTop: number;
    /** Where the notes stood, which the box is kept inside. */
    readonly grid: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null;
    /** Whether what it holds is added to the notes chosen, rather than chosen alone. */
    readonly adds: boolean;
    /** Whether it has gone far enough to be a box rather than a click. */
    readonly drawn: boolean;
  } | null = null;
  /**
   * The pedal's lane held by a pointer while a sketch is edited: a press of
   * the pedal taken hold of by its end or as a whole, or none where a new one
   * is being drawn; and the sketch as the pointer has it so far, once it has
   * changed it.
   */
  rollPedalDrag: {
    readonly pointerId: number;
    readonly fromMs: number;
    readonly press: ScenePedal | null;
    readonly grip: Grip;
    readonly moved: readonly MidiFileEvent[] | null;
  } | null = null;
  /**
   * The key of an empty row of a sketch being edited that a mouse is held
   * down on, sounding till it is let go of or the drawing moves under it.
   */
  rowHeld: { readonly pointerId: number; readonly midi: number } | null = null;
  /** Where the marker was before a tap on nothing moved it, to go back to if it was the first of two. */
  private placedBeforeTheTap: number | null = null;

  /**
   * The notes chosen on a drawing that is not a sketch - a score, a
   * recording, the run - to be copied into one, and the drawing they are of:
   * another drawing shown, they are chosen on it no longer.
   */
  private chosenToCopy: { readonly roll: RunRoll; readonly chosen: readonly KeyNamed[] } | null = null;

  constructor(host: TheViewOfTheSketch) {
    this.host = host;
  }

  /**
   * A click on a sketch being edited where the press found no note: a note
   * is written there, unless a key held said the click was to choose - a
   * choice adds nothing to the music. A note itself is answered when it is
   * let go of: see `letGoOfTheHeldKey`. A click alone puts the marker
   * there; two, writing a note, leave it where it was before the first.
   */
  chooseTheKeyTapped(event: MouseEvent, pressedWith: string | null): void {
    if (this.host.theKeyUnder(event) !== null) {
      return;
    }
    const keyHeld = event.ctrlKey || event.metaKey || event.shiftKey;
    // The second of two taps where there is nothing writes a note there, and
    // takes the marker back to where the first found it.
    if (this.isASecondTap(event, null) && !keyHeld) {
      this.addAKeyWhereTapped(event);
      if (this.placedBeforeTheTap !== null) {
        this.host.putTheHeadAt(this.placedBeforeTheTap);
      }
      return;
    }
    // One puts the marker there, to listen from, and lets go of the notes
    // chosen - unless a key held says the click was to choose.
    if (!keyHeld && (this.host.theOtherRollShowing?.sketch?.chosen.length ?? 0) > 0) {
      this.choose([]);
    }
    // A mouse sounded it as it went down.
    if (pressedWith !== 'mouse') {
      this.soundTheRowTapped(event);
    }
    this.placedBeforeTheTap = this.host.rollPlacedAtMs;
    this.host.putTheHeadWhereItWasTapped(event);
  }

  /**
   * Sounds the key of the row a tap found empty, for a moment, as loud as a
   * note written there would be: which key a row is, heard before a second
   * tap writes it. Both ends handed to the instrument at once, so no timer
   * outlives the drawing.
   */
  private soundTheRowTapped(event: MouseEvent): void {
    const tapped = this.theRowTapped(event);
    if (tapped === null) {
      return;
    }
    const now = this.host.runtime.clock.now();
    const atMs = tapped.atMs + rollBeganAtMs(tapped.roll);
    this.theEditingsInstrument.play(tapped.midi, theLoudnessWrittenAt(tapped.stored.events, atMs), now);
    this.host.runtime.pitchPlayer.stop(tapped.midi, now + HEARD_ON_A_TAP_MS);
  }

  /**
   * Sounds the key of an empty row of a sketch being edited a mouse goes
   * down on, as loud as a note written there would be, until it is let go
   * of: as a key of the strip is held. A finger sounds it on the tap
   * instead, since a finger going down on the drawing is as often the
   * start of moving it.
   */
  holdTheRowPressed(event: PointerEvent): void {
    if (
      event.pointerType !== 'mouse' ||
      event.button !== 0 ||
      this.host.theOtherRollShowing?.sketch?.editing !== true ||
      this.host.isOnTheRuler(event) ||
      this.host.isOnTheChords(event)
    ) {
      return;
    }
    const pressed = this.theRowTapped(event);
    if (pressed === null) {
      return;
    }
    this.letGoOfTheRowHeld();
    const atMs = pressed.atMs + rollBeganAtMs(pressed.roll);
    this.theEditingsInstrument.play(pressed.midi, theLoudnessWrittenAt(pressed.stored.events, atMs));
    this.rowHeld = { pointerId: event.pointerId, midi: pressed.midi };
    this.host.lightTheSoundingRows();
  }

  /**
   * The instrument as what is done to the notes of a drawing strikes it:
   * not at all while that is asked for. What it struck is let go of on the
   * instrument itself, so a key struck before it went quiet is not left
   * sounding.
   */
  get theEditingsInstrument(): Pick<IPitchPlayer, 'play'> {
    // The kit while the drums are written: a row there is a drum.
    const instrument = this.host.theOtherRollShowing?.sketch?.drums === true ? this.host.runtime.drumKit : this.host.runtime.pitchPlayer;
    return {
      play: (midi, velocity, atMs) => {
        if (this.host.runtime.controller.settings.rollSounds) {
          instrument.play(midi, velocity, atMs);
        }
      },
    };
  }

  /** Lets go of the key of the row a mouse held down, if one is. */
  letGoOfTheRowHeld(): void {
    const held = this.rowHeld;
    if (held === null) {
      return;
    }
    this.rowHeld = null;
    this.host.runtime.pitchPlayer.stop(held.midi);
    this.host.lightTheSoundingRows();
  }

  /**
   * The key of the row a tap on the sketch being edited is in, and the
   * moment on the drawing it is at; `null` off the keys there are.
   */
  private theRowTapped(
    event: MouseEvent,
  ): { readonly midi: number; readonly atMs: number; readonly stored: StoredSketch; readonly roll: RunRoll } | null {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const at = this.host.thePointOnTheDrawing(event);
    const scene = this.host.drawnScene;
    if (showing === null || stored === null || at === null || scene === null) {
      return null;
    }
    const midi = scene.highest - at.row;
    // Only a row the drawing has: a key, or a drum of the kit.
    return midi < scene.highest - scene.rows + 1 || midi > scene.highest ? null : { midi, atMs: at.atMs, stored, roll: showing.roll };
  }

  /**
   * Whether a tap is the second of two on one place - the same note, or the
   * same empty space - close enough together in time and on the screen, and
   * neither with a key held. Worked out here rather than taken from the
   * browser, which sends a double click for a mouse but not reliably for a
   * finger on a tablet. A second tap is the end of a pair: the next starts
   * another.
   */
  isASecondTap(
    event: { readonly clientX: number; readonly clientY: number; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean },
    key: KeyNamed | null,
  ): boolean {
    const now = this.host.runtime.clock.now();
    const last = this.theLastTap;
    const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const second =
      plain &&
      last !== null &&
      now - last.atMs <= DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - last.clientX, event.clientY - last.clientY) <= DOUBLE_TAP_PX &&
      (key === null ? last.key === null : last.key !== null && sameKey(last.key, key));
    this.theLastTap = second || !plain ? null : { atMs: now, clientX: event.clientX, clientY: event.clientY, key };
    return second;
  }

  /** Makes these the notes chosen, and only these. */
  choose(keys: readonly KeyNamed[]): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const roll = this.host.theRoll();
    const chosen = keys.map((key) => ({ midi: key.midi, downAtMs: key.downAtMs }));
    if (chosen.length > 0) {
      // One thing chosen at a time: see `chooseTheMark`.
      this.host.markChosenAtMs = null;
    }
    if (showing !== null && sketch !== undefined) {
      this.host.theOtherRollShowing = { ...showing, sketch: { ...sketch, chosen } };
    } else if (sketch === undefined && roll !== null) {
      this.chosenToCopy = { roll, chosen };
    } else {
      return;
    }
    this.host.drawTheRollInto();
    this.host.sayWhatCanBeChanged();
  }

  /**
   * The notes chosen on the drawing shown: a sketch's, to change, or those
   * chosen on anything else to copy - while it is the drawing shown.
   */
  theNotesChosen(): readonly KeyNamed[] {
    const sketch = this.host.theOtherRollShowing?.sketch;
    if (sketch !== undefined) {
      return sketch.chosen;
    }
    const roll = this.host.theRoll();
    return roll !== null && this.chosenToCopy?.roll === roll ? this.chosenToCopy.chosen : [];
  }

  /**
   * Begins a box to choose notes by, where a mouse goes down on a sketch being
   * edited and no note is under it. Says whether it did. A finger moves the
   * drawing there instead, as it always has: a tablet has no other way to.
   */
  beginABox(event: PointerEvent): boolean {
    const sketch = this.host.theOtherRollShowing?.sketch;
    if (event.button !== 0 || this.rollBoxDrawn !== null) {
      return false;
    }
    // With the selection tool, for a mouse as for a finger - on a sketch
    // only while it is edited. Without it, a finger's drag from empty space
    // moves the drawing, and a mouse's, where nothing else answers it,
    // points.
    const boxes = sketch === undefined ? this.host.boxOnTheViewer : sketch.editing && sketch.tool === 'selection';
    if (!boxes) {
      return false;
    }
    if (this.host.isOnTheRuler(event)) {
      return false;
    }
    // Where the stage and the notes are, read once: the box is placed in the
    // one by the pointer, and kept to the other, past whose edge there is no
    // note to choose.
    const stage = this.host.el.rollBox.parentElement?.getBoundingClientRect();
    const grid = this.host.el.rollBody.firstElementChild?.querySelector<HTMLElement>('.roll__grid')?.getBoundingClientRect() ?? null;
    // Begun on the pedal under the notes, it begins at their edge.
    const from = theBoxCornerAt({ grid }, event);
    this.rollBoxDrawn = {
      pointerId: event.pointerId,
      clientX: from.clientX,
      clientY: from.clientY,
      stageLeft: stage?.left ?? 0,
      stageTop: stage?.top ?? 0,
      grid,
      adds: addsToTheChoice(event),
      drawn: false,
    };
    return true;
  }

  /** Draws the box from where the mouse went down to where it is: a box once it has gone somewhere. */
  drawTheBox(event: PointerEvent): void {
    const box = this.rollBoxDrawn;
    if (box === null) {
      return;
    }
    if (!box.drawn && Math.hypot(event.clientX - box.clientX, event.clientY - box.clientY) < TAP_SLOP_PX) {
      return;
    }
    this.rollBoxDrawn = { ...box, drawn: true };
    // A drag, so the click on letting go writes no note.
    this.host.panned = true;
    const to = theBoxCornerAt(box, event);
    const style = this.host.el.rollBox.style;
    style.left = `${String(Math.min(box.clientX, to.clientX) - box.stageLeft)}px`;
    style.top = `${String(Math.min(box.clientY, to.clientY) - box.stageTop)}px`;
    style.width = `${String(Math.abs(to.clientX - box.clientX))}px`;
    style.height = `${String(Math.abs(to.clientY - box.clientY))}px`;
    this.host.el.rollBox.hidden = false;
  }

  /**
   * Chooses the notes the box holds as it is let go of: those alone, or added
   * to those chosen where a key held said so. Let go of off the page, it
   * chooses nothing. A box never drawn was a click, which writes a note.
   */
  chooseWhatTheBoxHolds(event: PointerEvent, lifted: boolean): void {
    const box = this.rollBoxDrawn;
    this.rollBoxDrawn = null;
    this.host.el.rollBox.hidden = true;
    const roll = this.host.theRoll();
    const scene = this.host.drawnScene;
    const from = box === null ? null : this.host.thePointOnTheDrawing(box);
    const to = box === null ? null : this.host.thePointOnTheDrawing(theBoxCornerAt(box, event));
    if (box === null || !box.drawn || !lifted || roll === null || scene === null) {
      return;
    }
    if (from === null || to === null) {
      return;
    }
    const held = theKeysInABox(
      roll,
      scene,
      { fromMs: from.atMs, toMs: to.atMs, fromRow: from.row, toRow: to.row },
      Number(this.host.el.rollZoom.value),
    );
    const chosen = this.theNotesChosen();
    this.choose(box.adds ? [...chosen, ...held.filter((key) => !chosen.some((each) => sameKey(each, key)))] : held);
  }

  /** Adds a key to the notes chosen, or lets go of it where it was one of them. */
  private chooseOrLetGo(key: KeyNamed): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    if (showing === null || sketch === undefined) {
      return;
    }
    const chosen = sketch.chosen.some((each) => sameKey(each, key))
      ? sketch.chosen.filter((each) => !sameKey(each, key))
      : [...sketch.chosen, { midi: key.midi, downAtMs: key.downAtMs }];
    this.host.theOtherRollShowing = { ...showing, sketch: { ...sketch, chosen } };
    this.host.drawTheRollInto();
    this.host.sayWhatCanBeChanged();
  }

  /**
   * Writes a note into the sketch where a tap found none: on the key of the
   * row, on the nearest line of the grid where the marker is put on one,
   * a beat long, as loud as the notes around it are on the whole. It is the
   * one chosen, to be moved where it was not quite meant.
   */
  private addAKeyWhereTapped(event: MouseEvent): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const tapped = this.theRowTapped(event);
    if (showing === null || sketch === undefined || tapped === null) {
      return;
    }
    const { midi, stored, roll } = tapped;
    const origin = rollBeganAtMs(roll);
    // In the cell of the grid tapped in, from the line it begins on.
    const snapped = this.host.el.rollSnap.checked ? theLineOfTheGridUnder(roll, tapped.atMs, this.host.theRollsGrid()) : tapped.atMs;
    const downAtMs = Math.round(snapped + origin);
    // Never on or over another of its pitch: cut short where the next begins,
    // and not written where it would begin on or inside one.
    const upAtMs = theEndAKeyFitsTo(stored.events, { midi, downAtMs, upAtMs: downAtMs + theBeatAt(roll, downAtMs) });
    if (upAtMs === null) {
      return;
    }
    const key = {
      midi,
      downAtMs,
      upAtMs,
      velocity: theLoudnessWrittenAt(stored.events, downAtMs),
      loudness: { level: null, shade: 0 },
    };
    // Heard as it is written, for as long as it is: both ends handed to the
    // instrument at once, so no timer outlives the drawing.
    const now = this.host.runtime.clock.now();
    this.theEditingsInstrument.play(midi, key.velocity, now);
    this.host.runtime.pitchPlayer.stop(midi, now + (key.upAtMs - key.downAtMs));
    this.host.changeTheSketchShowing(takeWithAKeyAdded(stored.events, key), [...sketch.before, asItWas(stored, sketch.chosen)], [
      { midi, downAtMs },
    ]);
  }

  /** The press of the pedal drawn at a moment from the run's start, if there is one. */
  thePedalPressAt(atMs: number): ScenePedal | null {
    return this.host.drawnScene?.pedal.find((press) => press.fromMs <= atMs && atMs <= press.untilMs) ?? null;
  }

  /**
   * Takes hold of the pedal's lane of a sketch being edited, where a finger,
   * a pen or the mouse goes down on it: a press of the pedal by an end - the
   * first or last few pixels of it - or as a whole, or the place a new one is
   * drawn from. Says whether it did.
   */
  takeHoldOfThePedal(event: PointerEvent): boolean {
    if (
      this.host.theOtherRollShowing?.sketch?.editing !== true ||
      !this.host.isOnThePedal(event) ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return false;
    }
    const at = this.host.theMomentUnder(event.clientX);
    if (at === null) {
      return false;
    }
    const press = this.thePedalPressAt(at);
    const grip = press === null ? 'whole' : theGripOfAStretch(press.fromMs, press.untilMs, at, Number(this.host.el.rollZoom.value) / 1000);
    this.rollPedalDrag = { pointerId: event.pointerId, fromMs: at, press, grip, moved: null };
    return true;
  }

  /**
   * The sketch as the pointer on the pedal's lane has it so far: a press drawn
   * from where it went down to where it is, or the press taken hold of made
   * longer or shorter by either end, or moved - each on the nearest line of the
   * grid where the marker is put on one, and exactly with Shift. Shown, and
   * kept to be kept when the pointer lets go.
   */
  dragThePedal(event: PointerEvent): void {
    const drag = this.rollPedalDrag;
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const at = this.host.theMomentUnder(event.clientX);
    if (drag === null || showing === null || sketch === undefined || stored === null || at === null) {
      return;
    }
    const roll = showing.roll;
    const origin = rollBeganAtMs(roll);
    const snapping = this.host.el.rollSnap.checked && !event.shiftKey;
    const snap = (ms: number): number => (snapping ? theBeatNearest(roll, ms, this.host.theRollsGrid()) : ms);
    const onTheRun = (ms: number): number => Math.round(ms + origin);
    const press = drag.press;
    let moved: readonly MidiFileEvent[] | null = null;
    if (press === null) {
      const ends = [snap(drag.fromMs), snap(at)].sort((one, other) => one - other);
      const [from = 0, until = 0] = ends;
      if (until - from >= SHORTEST_NOTE_MS) {
        moved = takeWithThePedalAt(stored.events, onTheRun(from), onTheRun(until), true);
      }
    } else {
      const endless = press.open ? Number.POSITIVE_INFINITY : null;
      const freed = takeWithThePedalAt(stored.events, onTheRun(press.fromMs), endless ?? onTheRun(press.untilMs), false);
      if (drag.grip === 'end') {
        const until = Math.max(snap(press.untilMs + (at - drag.fromMs)), press.fromMs + SHORTEST_NOTE_MS);
        if (until !== press.untilMs) {
          moved = takeWithThePedalAt(freed, onTheRun(press.fromMs), onTheRun(until), true);
        }
      } else if (drag.grip === 'start') {
        // Put down earlier or later, and let up where it was: never after that, nor before the run.
        const from = Math.max(0, Math.min(snap(press.fromMs + (at - drag.fromMs)), press.untilMs - SHORTEST_NOTE_MS));
        if (from !== press.fromMs) {
          moved = takeWithThePedalAt(freed, onTheRun(from), endless ?? onTheRun(press.untilMs), true);
        }
      } else {
        const by = Math.max(0, snap(press.fromMs + (at - drag.fromMs))) - press.fromMs;
        if (by !== 0) {
          moved = takeWithThePedalAt(freed, onTheRun(press.fromMs + by), endless ?? onTheRun(press.untilMs + by), true);
        }
      }
    }
    this.rollPedalDrag = { ...drag, moved };
    this.host.drawnScene = this.host.theSceneToDraw(rollOfTheTake({ ...stored, events: moved ?? stored.events }, ROOM_IN_A_SKETCH), sketch.chosen);
    this.host.paintTheRoll();
  }

  /**
   * Lets go of the pedal's lane: what a drag made of the sketch kept, one change
   * put back as one, or drawn as it was where the pointer was taken away. A
   * press let go of without a drag was a tap: the second of two on a press of
   * the pedal takes it out, and one on the empty lane puts the marker there.
   * The click of letting go is taken as answered here.
   */
  letGoOfThePedal(event: PointerEvent, lifted: boolean): void {
    const drag = this.rollPedalDrag;
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    this.rollPedalDrag = null;
    if (drag === null) {
      return;
    }
    this.host.panned = true;
    if (drag.moved !== null) {
      if (lifted && sketch !== undefined && stored !== null) {
        this.host.changeTheSketchShowing(drag.moved, [...sketch.before, asItWas(stored, sketch.chosen)], sketch.chosen);
      } else {
        this.host.drawTheRollInto();
      }
      return;
    }
    if (!lifted) {
      return;
    }
    if (drag.press === null) {
      this.host.putTheHeadWhereItWasTapped(event);
    } else if (this.isASecondTap(event, { midi: THE_PEDALS_ROW, downAtMs: drag.press.fromMs })) {
      this.letGoOfThePedalPress(drag.press);
    }
  }

  /** Takes a press of the pedal out of the sketch being edited: one change, put back as one. */
  letGoOfThePedalPress(press: ScenePedal): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    const origin = rollBeganAtMs(showing.roll);
    const events = takeWithThePedalAt(
      stored.events,
      Math.round(press.fromMs + origin),
      press.open ? Number.POSITIVE_INFINITY : Math.round(press.untilMs + origin),
      false,
    );
    this.host.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], sketch.chosen);
  }

  /**
   * Cuts the key of a sketch being edited in two where the mouse or a pen goes
   * down on it with Alt held: on the nearest line of the grid where the marker
   * is put on one, and exactly there with Shift or with the grid let go of -
   * never leaving a part shorter than a note can be heard as. Both parts are
   * chosen, one change put back as one. Says whether the press was taken.
   */
  cutTheKeyUnder(event: PointerEvent): boolean {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    if (
      showing === null ||
      sketch?.editing !== true ||
      !event.altKey ||
      event.pointerType === 'touch' ||
      event.button !== 0 ||
      this.host.isOnTheRuler(event)
    ) {
      return false;
    }
    const key = this.host.theKeyUnder(event);
    const at = this.host.thePointOnTheDrawing(event);
    const stored = this.host.theSketchAsDrawn(sketch.id);
    if (key === null || at === null || stored === null) {
      return false;
    }
    const origin = rollBeganAtMs(showing.roll);
    const snapped = this.host.el.rollSnap.checked && !event.shiftKey ? theBeatNearest(showing.roll, at.atMs, this.host.theRollsGrid()) : at.atMs;
    const atMs = Math.round(snapped + origin);
    const endMs = key.upAtMs ?? rollEndedAtMs(showing.roll);
    // Taken either way: an Alt-press on a note is a cut, never a drag.
    if (atMs - key.downAtMs < SHORTEST_NOTE_MS || endMs - atMs < SHORTEST_NOTE_MS) {
      return true;
    }
    const events = takeWithTheKeyCut(stored.events, key, atMs);
    if (events !== null) {
      this.host.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], [
        { midi: key.midi, downAtMs: key.downAtMs },
        { midi: key.midi, downAtMs: atMs },
      ]);
    }
    return true;
  }

  /**
   * Takes hold of a key of a sketch being edited, where a finger or the mouse
   * goes down on it. Says whether it did. Anywhere else the drawing is moved,
   * as it always was. What a drag from it moves is decided as it begins, and
   * a press let go of without one is a tap: see `letGoOfTheHeldKey`. A
   * pointer taken off the drawing lets go of it as it was, which is what a
   * drag carried off the edge of anything means.
   */
  takeHoldOfAKey(event: PointerEvent): boolean {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const scene = this.host.drawnScene;
    if (showing === null || sketch === undefined || !sketch.editing || this.rollDrag !== null || scene === null || this.host.isOnTheRuler(event)) {
      return false;
    }
    const key = this.host.theKeyUnder(event);
    const stored = this.host.theSketchAsDrawn(sketch.id);
    if (key === null || stored === null) {
      return false;
    }
    // Chosen as it is pressed, so it is lit while held: alone where it was
    // not chosen, added or taken out with a key held. One already chosen
    // stays among the rest, which a drag from it moves together; a press let
    // go of without one chooses it alone - see `letGoOfTheHeldKey`.
    const named = { midi: key.midi, downAtMs: key.downAtMs };
    const adds = addsToTheChoice(event);
    const copies = event.ctrlKey || event.metaKey;
    const wasChosen = sketch.chosen.some((each) => sameKey(each, key));
    // With Ctrl, one already chosen stays chosen while held: dragged, it and
    // the rest are copied; tapped, it is taken out as it is let go of.
    const letsGoOfIt = copies && wasChosen;
    if (adds && !letsGoOfIt) {
      this.chooseOrLetGo(named);
    } else if (!adds && !wasChosen) {
      this.choose([named]);
    }
    this.rollDrag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scene,
      moved: null,
      key: named,
      adds,
      letsGoOfIt,
      copies,
      grip: this.theGripOn(key, event),
      upAtMs: key.upAtMs ?? rollEndedAtMs(showing.roll),
    };
    this.soundTheHeldKeys(
      oneKeyForEachPitch(this.theKeysDragged(this.rollDrag, stored.events)),
      0,
    );
    return true;
  }

  /**
   * Sounds the keys held where they now are, until they are let go of or
   * taken to another pitch: keys moved along their rows go on sounding
   * rather than being struck again.
   */
  private soundTheHeldKeys(keys: readonly { readonly midi: number; readonly velocity: number }[], bySemitones: number): void {
    this.letTheHeldKeysFallSilent();
    for (const key of keys) {
      this.theEditingsInstrument.play(key.midi + bySemitones, key.velocity);
    }
    this.soundOfTheHeldKeys = { keys, bySemitones };
  }

  private letTheHeldKeysFallSilent(): void {
    const sounding = this.soundOfTheHeldKeys;
    if (sounding !== null) {
      for (const key of sounding.keys) {
        this.host.runtime.pitchPlayer.stop(key.midi + sounding.bySemitones);
      }
      this.soundOfTheHeldKeys = null;
    }
  }

  /** Which part of a key a point is on: see `theGripOfAStretch`. */
  private theGripOn(key: RolledPress, point: { readonly clientX: number; readonly clientY: number }): Grip {
    const roll = this.host.theRoll();
    const at = this.host.thePointOnTheDrawing(point);
    if (roll === null || at === null) {
      return 'whole';
    }
    const origin = rollBeganAtMs(roll);
    return theGripOfAStretch(
      key.downAtMs - origin,
      (key.upAtMs ?? rollEndedAtMs(roll)) - origin,
      at.atMs,
      Number(this.host.el.rollZoom.value) / 1000,
    );
  }

  /**
   * Says, by the pointer's shape, what the mouse would take hold of where it
   * rests on a sketch being edited: a note or a press of the pedal, or one
   * end of either.
   */
  showTheGrip(event: PointerEvent): void {
    const editing = this.host.theOtherRollShowing?.sketch?.editing === true;
    let grip: Grip | null = null;
    if (this.host.isOnTheRuler(event)) {
      grip = this.host.theGripOnTheSlice(event.clientX);
    } else if (editing && this.host.isOnThePedal(event)) {
      const at = this.host.theMomentUnder(event.clientX);
      const press = at === null ? null : this.thePedalPressAt(at);
      grip = press === null || at === null ? null : theGripOfAStretch(press.fromMs, press.untilMs, at, Number(this.host.el.rollZoom.value) / 1000);
    } else {
      const key = editing && !this.host.isOnTheChords(event) ? this.host.theKeyUnder(event) : null;
      grip = key === null ? null : this.theGripOn(key, event);
    }
    if (grip === null) {
      delete this.host.el.rollBody.dataset['grip'];
      return;
    }
    this.host.el.rollBody.dataset['grip'] = grip === 'whole' ? 'note' : grip;
  }

  /**
   * The keys a drag from a held key changes, as they are in the sketch now:
   * all the chosen ones where it is one of them, and only itself where it is
   * not - one taken out of the choice as it was pressed is moved alone.
   */
  private theKeysDragged(drag: NonNullable<SketchEditing['rollDrag']>, events: readonly MidiFileEvent[]): KeyOfTheTake[] {
    const chosen = this.host.theOtherRollShowing?.sketch?.chosen ?? [];
    const moving = chosen.some((each) => sameKey(each, drag.key)) ? chosen : [drag.key];
    return theKeysOfTheTake(events).filter((key) => moving.some((each) => sameKey(each, key)));
  }

  /**
   * Moves the keys a drag holds to where the pointer has taken the one it
   * began on: across by time, that one on the nearest line of the grid where
   * the marker would be put on one and the others by as much, and up or down
   * by pitch as far as all of them stay inside the rows drawn. Shown by
   * painting the drawing again, not by building it again, which is too slow
   * to follow a finger.
   */
  dragTheHeldKey(event: PointerEvent): void {
    const drag = this.rollDrag;
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (drag === null || showing === null || stored === null) {
      return;
    }
    const acrossPx = event.clientX - drag.clientX;
    const downPx = event.clientY - drag.clientY;
    if (drag.moved === null && Math.hypot(acrossPx, downPx) < TAP_SLOP_PX) {
      return;
    }
    // A drag, so the click the finger makes on letting go is not a tap.
    this.host.panned = true;
    const origin = rollBeganAtMs(showing.roll);
    const keys = this.theKeysDragged(drag, stored.events);
    // On the grid where the marker is put on one, unless Shift is held now:
    // then exactly where the pointer takes it.
    const snapping = this.host.el.rollSnap.checked && !event.shiftKey;
    if (drag.grip === 'end') {
      this.dragTheEndsOfTheKeys(drag, keys, stored, acrossPx, origin, snapping);
      return;
    }
    if (drag.grip === 'start') {
      this.dragTheStartsOfTheKeys(drag, keys, stored, acrossPx, origin, snapping);
      return;
    }
    const wanted = drag.key.downAtMs - origin + (acrossPx / Number(this.host.el.rollZoom.value)) * 1000;
    // On a grid fine enough for the note: a quaver goes before a beat as well as on it.
    const grid = theGridForANote(showing.roll, this.host.theRollsGrid(), drag.key.downAtMs - origin, drag.upAtMs - drag.key.downAtMs);
    const at = snapping ? theBeatNearest(showing.roll, wanted, grid) : wanted;
    const byMs = Math.round(at + origin) - drag.key.downAtMs;
    const lowest = drag.scene.highest - drag.scene.rows + 1;
    const pitches = keys.map((key) => key.midi);
    const bySemitones = Math.min(
      drag.scene.highest - Math.max(...pitches),
      Math.max(lowest - Math.min(...pitches), -Math.round(downPx / this.host.rollLook.rowPx)),
    );
    const shown = this.showTheDrag(
      drag,
      stored,
      keys.map((key) => ({
        key,
        midi: key.midi + bySemitones,
        downAtMs: key.downAtMs + byMs,
        upAtMs: key.upAtMs === null ? null : key.upAtMs + byMs,
      })),
      drag.copies ? { byMs, bySemitones } : null,
    );
    // Heard where they are shown: a place refused is not where they went.
    const sounding = this.soundOfTheHeldKeys;
    if (shown && sounding !== null && sounding.bySemitones !== bySemitones) {
      this.soundTheHeldKeys(sounding.keys, bySemitones);
    }
  }

  /**
   * Holds the keys a drag holds longer or shorter: the end of the one it began
   * on where the pointer has taken it, on the nearest line of the grid where
   * the marker would be put on one, and the others' by as much. None shorter
   * than to the next line of the grid after it begins, where the end is put
   * on one - pulled back past its start, a note was left a sliver off the
   * grid - nor, put anywhere, than a note can be heard as one.
   */
  private dragTheEndsOfTheKeys(
    drag: NonNullable<SketchEditing['rollDrag']>,
    keys: readonly KeyOfTheTake[],
    stored: StoredSketch,
    acrossPx: number,
    origin: number,
    snapping: boolean,
  ): void {
    const showing = this.host.theOtherRollShowing;
    if (showing === null) {
      return;
    }
    const wanted = drag.upAtMs - origin + (acrossPx / Number(this.host.el.rollZoom.value)) * 1000;
    const grid = this.host.theRollsGrid();
    const at = snapping ? theEndNearest(showing.roll, grid, drag.key.downAtMs - origin, wanted) : wanted;
    const byMs = Math.round(at + origin) - drag.upAtMs;
    const end = rollEndedAtMs(showing.roll);
    const shortest = (key: KeyOfTheTake): number => {
      const from = key.downAtMs - origin;
      const line = snapping ? theEndNearest(showing.roll, grid, from, from) : from;
      return line > from + 0.5 ? Math.round(line + origin) : key.downAtMs + SHORTEST_NOTE_MS;
    };
    this.showTheDrag(
      drag,
      stored,
      keys.map((key) => ({
        key,
        midi: key.midi,
        downAtMs: key.downAtMs,
        upAtMs: Math.max((key.upAtMs ?? end) + byMs, shortest(key)),
      })),
    );
  }

  /**
   * Begins the keys a drag holds earlier or later, each let go of where it
   * was: the start of the one it began on where the pointer has taken it, on
   * the nearest line of the grid where the marker would be put on one, and
   * the others' by as much. None later than the last line of the grid before
   * it ends, where the start is put on one, nor, put anywhere, than leaves a
   * note too short to be heard as one; and none before the run begins.
   */
  private dragTheStartsOfTheKeys(
    drag: NonNullable<SketchEditing['rollDrag']>,
    keys: readonly KeyOfTheTake[],
    stored: StoredSketch,
    acrossPx: number,
    origin: number,
    snapping: boolean,
  ): void {
    const showing = this.host.theOtherRollShowing;
    if (showing === null) {
      return;
    }
    const wanted = drag.key.downAtMs - origin + (acrossPx / Number(this.host.el.rollZoom.value)) * 1000;
    const grid = this.host.theRollsGrid();
    const at = snapping ? theStartNearest(showing.roll, grid, drag.upAtMs - origin, wanted) : wanted;
    const byMs = Math.round(at + origin) - drag.key.downAtMs;
    const end = rollEndedAtMs(showing.roll);
    const latest = (key: KeyOfTheTake): number => {
      const until = (key.upAtMs ?? end) - origin;
      const line = snapping ? theStartNearest(showing.roll, grid, until, until) : until;
      return line < until - 0.5 ? Math.round(line + origin) : until + origin - SHORTEST_NOTE_MS;
    };
    this.showTheDrag(
      drag,
      stored,
      keys.map((key) => ({
        key,
        midi: key.midi,
        // Nor before the run begins, as a press of the pedal is not.
        downAtMs: Math.max(Math.min(key.downAtMs, origin), Math.min(key.downAtMs + byMs, latest(key))),
        upAtMs: key.upAtMs,
      })),
    );
  }

  /**
   * Paints the sketch as a drag has it so far, and keeps it to be kept when
   * the pointer lets go - the keys moved, or, where it copies, copies of them
   * moved and the keys left where they were - unless a key would be over
   * another of its pitch, when the drag stays where it last fitted, to go on
   * from there once it fits again. Says whether it was shown.
   */
  private showTheDrag(
    drag: NonNullable<SketchEditing['rollDrag']>,
    stored: StoredSketch,
    changes: readonly KeyChange[],
    copied: { readonly byMs: number; readonly bySemitones: number } | null = null,
  ): boolean {
    const events =
      copied === null
        ? takeWithTheKeysChanged(stored.events, changes)
        : takeWithTheKeysCopied(
            stored.events,
            changes.map(({ key }) => key),
            copied.byMs,
            copied.bySemitones,
          );
    const to = changes.map(({ midi, downAtMs }) => ({ midi, downAtMs }));
    if (events === null || aKeyIsOverAnotherOfItsPitch(events, to)) {
      return false;
    }
    this.rollDrag = { ...drag, moved: { to, events } };
    this.host.drawnScene = this.host.theSceneToDraw(rollOfTheTake({ ...stored, events }, ROOM_IN_A_SKETCH), to);
    this.host.paintTheRoll();
    return true;
  }

  /**
   * Lets go of the key held: where a drag took the keys on a finger lifted,
   * the sketch changed as a delete changes it, those keys chosen; drawn as it
   * was where the pointer was taken away instead. Without a drag it was a tap
   * on the note, and the click of letting go is taken as answered here.
   */
  letGoOfTheHeldKey(lifted: PointerEvent | null): void {
    this.letTheHeldKeysFallSilent();
    const drag = this.rollDrag;
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    this.rollDrag = null;
    if (drag === null) {
      return;
    }
    if (drag.moved === null) {
      if (lifted !== null) {
        this.host.panned = true;
        // The second of two taps on a note takes it out.
        if (this.isASecondTap(lifted, drag.key)) {
          this.deleteTheKey(drag.key);
          return;
        }
        // Added or taken out as it was pressed; otherwise chosen alone.
        if (drag.letsGoOfIt) {
          this.chooseOrLetGo(drag.key);
        } else if (!drag.adds) {
          this.choose([drag.key]);
        }
      }
      return;
    }
    if (lifted !== null && sketch !== undefined && stored !== null) {
      this.host.changeTheSketchShowing(drag.moved.events, [...sketch.before, asItWas(stored, sketch.chosen)], drag.moved.to);
    } else {
      this.host.drawTheRollInto();
    }
  }

  /**
   * The keys an editor answers to, while a sketch is being edited and nothing
   * is being typed: Delete or Backspace takes the chosen notes out, and Ctrl+Z
   * (Cmd+Z on a Mac) puts back the last change - the trash and the undo
   * buttons, without leaving the keyboard. The arrows move the chosen notes,
   * and with Ctrl (Cmd) copy them there instead. Ctrl+C and Ctrl+X copy the
   * chosen notes to the clipboard, and cut them; a paste is answered by
   * `pasteTheNotesCopied`.
   */
  editByTheKeys(event: KeyboardEvent): void {
    if (this.host.el.sheetRoll.hidden || isTypedInto(event.target as TypedInto | null)) {
      return;
    }
    if (this.host.theOtherRollShowing?.sketch === undefined) {
      this.chooseByTheKeys(event);
      return;
    }
    if (!this.host.theOtherRollShowing.sketch.editing) {
      return;
    }
    if (this.host.markChosenAtMs !== null && (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace')) {
      // A flag chosen answers first: let go of, or taken away.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        this.host.chooseTheMark(null);
      } else {
        this.host.takeTheMarkAway(this.host.markChosenAtMs);
      }
      return;
    }
    const copying = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.code === 'KeyC' || event.code === 'KeyX');
    if (this.host.markChosenAtMs !== null && copying) {
      event.preventDefault();
      this.host.copyTheMarkChosen(event.code === 'KeyX');
      return;
    }
    if (event.key === 'Escape' && this.host.chordsBeingForgotten) {
      // The deleting ends first, then what is chosen, then the sheet.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.host.chordsBeingForgotten = false;
      this.host.showTheChordsOfTheKey();
      return;
    }
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    const chosen = this.host.theOtherRollShowing?.sketch?.chosen ?? [];
    if (command && event.code === 'KeyZ') {
      // With Shift it is a redo, as everywhere; Ctrl+Y is the other name for one.
      event.preventDefault();
      if (event.shiftKey) {
        this.bringBackTheLastPutBack();
      } else {
        this.putBackTheLastChange();
      }
    } else if (command && !event.shiftKey && event.code === 'KeyY') {
      event.preventDefault();
      this.bringBackTheLastPutBack();
    } else if (command && !event.shiftKey && event.code === 'KeyA') {
      // Every note, rather than every word on the page.
      event.preventDefault();
      const sketch = this.host.theOtherRollShowing?.sketch;
      const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
      this.choose(stored === null ? [] : theKeysOfTheTake(stored.events));
    } else if (event.key === 'Escape' && chosen.length > 0) {
      // First what is chosen is let go of; the next Escape shuts the sheet.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.choose([]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteTheChosenKeys();
    } else if (command && !event.shiftKey && (event.code === 'KeyC' || event.code === 'KeyX') && chosen.length > 0) {
      // Written on the key rather than on the browser's copy, which a browser
      // with no text chosen on the page need not send.
      event.preventDefault();
      this.copyTheChosenKeys(event.code === 'KeyX');
    } else if (command && event.code === 'KeyD' && chosen.length > 0) {
      // The other name for a copy just after, rather than a bookmark.
      event.preventDefault();
      this.moveTheChosenKeys('ArrowRight', false, true);
    } else if (
      !event.altKey &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
      // A list or a slider with the focus has its own use for them.
      !usesTheArrows(event.target instanceof Element ? event.target : null) &&
      chosen.length > 0
    ) {
      event.preventDefault();
      this.moveTheChosenKeys(event.key, event.shiftKey, command);
    }
  }

  /**
   * The keys that choose and copy notes on a drawing that is not a sketch,
   * as they do on one: everything, nothing, and a copy. Nothing there is
   * changed, so nothing else is answered.
   */
  private chooseByTheKeys(event: KeyboardEvent): void {
    const command = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const roll = this.host.theRoll();
    const chosen = this.theNotesChosen();
    if (command && event.code === 'KeyA' && roll !== null) {
      event.preventDefault();
      this.choose(roll.presses);
    } else if (event.key === 'Escape' && chosen.length > 0) {
      // First what is chosen is let go of; the next Escape shuts the sheet.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.choose([]);
    } else if (command && event.code === 'KeyC' && chosen.length > 0) {
      event.preventDefault();
      this.copyTheChosenKeys(false);
    }
  }

  /**
   * Copies the chosen notes to the clipboard, as text a paste here can read
   * back - into this sketch or another, in this tab or another - and cutting,
   * takes them out as the trash would, to be put back by an undo should the
   * clipboard refuse them.
   */
  copyTheChosenKeys(cutting: boolean): void {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const roll = this.host.theRoll();
    const clipboard = this.host.doc.defaultView?.navigator?.clipboard;
    // A sketch's notes as it keeps them; anything else's as its drawing has them.
    const events = stored !== null ? stored.events : sketch === undefined && roll !== null ? rollAsEvents(roll) : null;
    if (events === null) {
      return;
    }
    const notes = theNotesCopied(events, this.theNotesChosen());
    if (notes.length > 0) {
      this.host.notesCopiedHere = notes;
      this.host.sayWhetherThereIsAnythingToPaste();
    }
    // A page not served securely has no clipboard, and a cut there would only delete.
    if (clipboard === undefined) {
      return;
    }
    if (notes.length > 0) {
      void clipboard.writeText(theClipboardTextOf(notes)).catch(() => undefined);
    }
    if (cutting) {
      this.deleteTheChosenKeys();
    }
  }

  /**
   * Puts notes copied into the sketch being edited, the first of them where
   * the head is, and chooses them: one change, put back as one. Read off the
   * browser's paste rather than asked of the clipboard, which a browser would
   * first ask the reader's leave for. Anything else on the clipboard is left
   * to the browser.
   */
  pasteTheNotesCopied(event: ClipboardEvent): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (
      this.host.el.sheetRoll.hidden ||
      showing === null ||
      sketch?.editing !== true ||
      stored === null ||
      isTypedInto(event.target as TypedInto | null)
    ) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const notes = theNotesOnTheClipboard(text);
    const change = theChangeOnTheClipboard(text);
    if (notes !== null) {
      event.preventDefault();
      this.pasteTheNotes(notes);
    } else if (change !== null) {
      event.preventDefault();
      this.host.pasteTheChange(change);
    }
  }

  /**
   * Pastes by the drawer's button, which has no paste event to read: the
   * clipboard is asked - which a browser may first ask the reader's leave
   * for - and where it cannot be read or holds neither notes nor a change,
   * what was last copied in this page is pasted.
   */
  pasteWithTheButton(): void {
    const clipboard = this.host.doc.defaultView?.navigator?.clipboard;
    const read =
      typeof clipboard?.readText === 'function'
        ? clipboard.readText().then((text) => text, () => '')
        : Promise.resolve('');
    void read.then((text) => {
      const notes = theNotesOnTheClipboard(text);
      const change = theChangeOnTheClipboard(text);
      if (notes !== null) {
        this.pasteTheNotes(notes);
      } else if (change !== null) {
        this.host.pasteTheChange(change);
      } else if (this.host.notesCopiedHere !== null) {
        this.pasteTheNotes(this.host.notesCopiedHere);
      } else if (this.host.changeCopiedHere !== null) {
        this.host.pasteTheChange(this.host.changeCopiedHere);
      }
    });
  }

  /** Puts notes copied into the sketch being edited, the first where the head is, and chooses them: one change. */
  private pasteTheNotes(notes: readonly NoteCopied[]): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    // Only onto a row the drawing has: notes copied from the keys are no
    // drums, and would be pasted where no row shows them.
    const scene = this.host.drawnScene;
    const onARow = scene === null ? notes : notes.filter((note) => note.midi <= scene.highest && note.midi > scene.highest - scene.rows);
    const { events, pasted } = takeWithTheNotesPasted(stored.events, onARow, this.host.rollAtMs + rollBeganAtMs(showing.roll));
    if (pasted.length > 0) {
      this.host.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], pasted);
    }
  }

  /** Takes the chosen keys out of the sketch, keeping what it was to be put back. */
  deleteTheChosenKeys(): void {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (sketch === undefined || sketch.chosen.length === 0 || stored === null) {
      return;
    }
    const events = takeWithoutTheKeys(stored.events, sketch.chosen);
    if (events !== null) {
      this.host.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)]);
    }
  }

  /**
   * Takes one note out of the sketch being edited - tapped twice, or clicked
   * with the right button: one change, put back as one. Only that note goes;
   * the others chosen stay so.
   */
  deleteTheKey(key: KeyNamed): void {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (sketch === undefined || stored === null) {
      return;
    }
    const events = takeWithoutTheKeys(stored.events, [key]);
    if (events !== null) {
      this.host.changeTheSketchShowing(
        events,
        [...sketch.before, asItWas(stored, sketch.chosen)],
        sketch.chosen.filter((each) => !sameKey(each, key)),
      );
    }
  }

  /** Puts the sketch back as it was before its last change, keeping what it was for a redo. */
  putBackTheLastChange(): void {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const last = sketch?.before.at(-1);
    if (sketch === undefined || stored === null || last === undefined) {
      return;
    }
    this.host.changeTheSketchShowing(
      last.events,
      sketch.before.slice(0, -1),
      last.chosen,
      last.beats,
      [...sketch.after, asItWas(stored, sketch.chosen)],
    );
  }

  /** Brings back what the last undo put back, while nothing has changed since. */
  bringBackTheLastPutBack(): void {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const last = sketch?.after.at(-1);
    if (sketch === undefined || stored === null || last === undefined) {
      return;
    }
    this.host.changeTheSketchShowing(
      last.events,
      [...sketch.before, asItWas(stored, sketch.chosen)],
      last.chosen,
      last.beats,
      sketch.after.slice(0, -1),
    );
  }

  /**
   * Moves the chosen notes by an arrow key: across to the next line of the
   * grid, the earliest of them onto it and the rest by as much; up or down a
   * semitone, or an octave with Shift - and not at all where one would leave
   * the keyboard. One change each, heard where it goes up or down.
   *
   * Copying, the chosen stay and copies of them go there and are chosen
   * instead - across, not to the next line but straight after them, or
   * before, from the first one's start to the last one's end: a figure
   * written again, and again on the next press.
   */
  private moveTheChosenKeys(arrow: string, octave: boolean, copying: boolean): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    const keys = theKeysOfTheTake(stored.events).filter((key) => sketch.chosen.some((each) => sameKey(each, key)));
    if (keys.length === 0) {
      return;
    }
    const moved = (byMs: number, bySemitones: number): readonly (KeyChange & { readonly key: KeyOfTheTake })[] =>
      keys.map((key) => ({
        key,
        midi: key.midi + bySemitones,
        downAtMs: key.downAtMs + byMs,
        upAtMs: key.upAtMs === null ? null : key.upAtMs + byMs,
      }));
    // A step onto a place another of a pitch holds goes on past it, to the
    // next where every one fits - or nowhere, where none is left that way.
    // The copies are asked of as the moved notes are: they are where those
    // would have gone.
    type Placed = {
      readonly changes: readonly (KeyChange & { readonly key: KeyOfTheTake })[];
      readonly events: readonly MidiFileEvent[];
    };
    const fits = (byMs: number, bySemitones: number): Placed | null => {
      const changes = moved(byMs, bySemitones);
      const events = copying
        ? takeWithTheKeysCopied(stored.events, keys, byMs, bySemitones)
        : takeWithTheKeysChanged(stored.events, changes);
      return events === null || aKeyIsOverAnotherOfItsPitch(events, changes) ? null : { changes, events };
    };
    let placed: Placed | null = null;
    let bySemitones = 0;
    if (arrow === 'ArrowLeft' || arrow === 'ArrowRight') {
      const origin = rollBeganAtMs(showing.roll);
      const earliest = Math.min(...keys.map((key) => key.downAtMs));
      const towards = arrow === 'ArrowRight' ? 1 : -1;
      if (copying) {
        // A key still down at the end is over its copy wherever that goes,
        // and alone it has no length to be followed on from.
        const span = Math.max(...keys.map((key) => key.upAtMs ?? key.downAtMs)) - earliest;
        if (span <= 0) {
          return;
        }
        const last = stored.events.at(-1)?.atMs ?? earliest;
        // Past every event of the sketch a copy fits or never will.
        for (let byMs = towards * span; placed === null; byMs += towards * span) {
          if (earliest + byMs < origin || earliest + byMs > last + span) {
            return;
          }
          placed = fits(byMs, 0);
        }
      } else {
        // Stepped on a grid fine enough for the first of them, as one is dragged.
        const first = keys.find((key) => key.downAtMs === earliest);
        const grid = theGridForANote(
          showing.roll,
          this.host.theRollsGrid(),
          earliest - origin,
          (first?.upAtMs ?? rollEndedAtMs(showing.roll)) - earliest,
        );
        for (let from = earliest - origin; placed === null; ) {
          const line = theNextLineOfTheGrid(showing.roll, from, grid, towards);
          if (line === null) {
            return;
          }
          placed = fits(Math.round(line + origin) - earliest, 0);
          from = line;
        }
      }
    } else {
      const step = (arrow === 'ArrowUp' ? 1 : -1) * (octave ? 12 : 1);
      // Only as far as the rows the drawing has: the keyboard's, or the kit's.
      const scene = this.host.drawnScene;
      const highestRow = scene?.highest ?? HIGHEST_KEY;
      const lowestRow = scene === null ? LOWEST_KEY : scene.highest - scene.rows + 1;
      for (bySemitones = step; placed === null; bySemitones += step) {
        if (keys.some((key) => key.midi + bySemitones < lowestRow || key.midi + bySemitones > highestRow)) {
          return;
        }
        placed = fits(0, bySemitones);
      }
    }
    if (placed === null) {
      return;
    }
    const { changes, events } = placed;
    if (bySemitones !== 0) {
      // Heard where they went, a moment each, both ends handed over at once.
      const now = this.host.runtime.clock.now();
      for (const { midi, velocity } of oneKeyForEachPitch(changes.map(({ midi, key }) => ({ midi, velocity: key.velocity })))) {
        this.theEditingsInstrument.play(midi, velocity, now);
        this.host.runtime.pitchPlayer.stop(midi, now + HEARD_ON_A_STEP_MS);
      }
    }
    this.host.changeTheSketchShowing(
      events,
      [...sketch.before, asItWas(stored, sketch.chosen)],
      changes.map(({ midi, downAtMs }) => ({ midi, downAtMs })),
    );
  }
}
