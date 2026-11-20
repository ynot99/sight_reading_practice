import {
  nameOfThePitchClass,
  nameTheChord,
  theChordTheKeysMake,
  theChordTheNotesMake,
  theNumeralOfTheChord,
  type ChordKind,
} from '../domain/harmony/chordName.js';
import { eachKeyOnce, theChordsOfTheScale } from '../domain/harmony/chordsOfTheKey.js';
import { theChordMovedTo } from '../domain/harmony/chordMoved.js';
import { midiToLabel } from '../domain/model/Pitch.js';
import { theHandThatPlays, type MidiFileEvent } from '../domain/midi/MidiFile.js';
import { theScaleOfTheKey, type SketchKey } from '../application/SketchLibrary.js';
import { MIDDLE_C } from './replayKeys.js';
import { sameKey, asItWas, oneKeyForEachPitch } from './sketchEditing.js';
import {
  rollBeganAtMs,
  rollEndedAtMs,
  takeWithTheKeysChanged,
  takeWithTheChordsBroken,
  theMusicsBeats,
  type ArpeggioWay,
  type KeyNamed,
  type RolledPress,
  type RunRoll,
} from '../application/session/RunRoll.js';
import { type NoteShownAhead } from './rollPainter.js';
import { theChordAt, theNotesOfTheChord, theNotesHeldIntoTheChord, type SceneChord } from './rollView.js';
import { theBrightnessOfTheChord, theTensionOfTheChord } from '../domain/harmony/chordFeeling.js';
import { theChordsTowards, type GoalOfTheNextChord } from '../domain/harmony/nextChord.js';
import { drawTheChart, showWhereOnTheChart, theChartOfTheChords, theCurvesOfTheChords } from './chordChart.js';
import { isTheMiddleOfTheCircle, showOnTheCircle, showTheChordOnTheKeys, thePlaceOnTheCircle } from './circleView.js';
import {
  theKeysAtThePlace,
  theKeysOfTheChord,
  theKeysOwnPlaces,
  theWayRoundTheCircle,
  whereOnTheCircle,
  type PlaceOnTheCircle,
} from '../domain/harmony/circleOfFifths.js';
import { sayWhetherIdle } from './dom.js';
import type { AppView } from './AppView.js';

/** How long a chord tapped in the lane sounds at most: long enough to be heard as a chord, short of a bar of one. */
const A_CHORD_TAPPED_SOUNDS_MS = 1_200;

/** The fewest notes a chord drafted on the keys under the circle is written with. */
const A_DRAFT_HAS_AT_LEAST = 2;

/**
 * How long a finger rests on a chord of the drawer before moving for the
 * move to slide over the others, each heard, rather than scroll the column
 * they stand in: a scroll is a finger moving as it comes down, a slide one
 * that has stopped to listen first.
 */
const A_FINGER_LISTENS_MS = 250;

/** How far a finger on a chord of the drawer goes before it is moving at all, and not only resting unsteadily. */
const A_FINGER_MOVES_PX = 8;

/**
 * A chord pressed or pointed at: one of the drawer, by its place there; one
 * of the circle, by its slice; or the one sounding, named in the circle's
 * middle (see `theChordSounding`).
 */
type ChordAskedFor =
  | { readonly inTheDrawer: number }
  | { readonly onTheCircle: PlaceOnTheCircle }
  | { readonly inTheMiddle: true };

/** A chord as the drawer offers it: its name, what is said under it, and its keys. */
interface ChordInTheDrawer {
  readonly name: string;
  readonly under: string;
  readonly midis: readonly number[];
  readonly kept: boolean;
}

/**
 * What a chord of the drawer would do to the sketch: the keys heard as it is
 * held, and struck by a key's press of its button; the sketch with it; the
 * notes chosen after; the notes it puts or moves, to show ahead; how loud,
 * how long it sounds, and where the cursor goes, or nowhere.
 */
export interface ChordWritten {
  /** Whether it changes the sketch at all: a chord written where it already is changes nothing, but is still heard. */
  readonly changes: boolean;
  readonly heard: readonly number[];
  readonly struck: readonly number[];
  readonly events: readonly MidiFileEvent[];
  readonly chosen: readonly KeyNamed[];
  readonly shown: readonly { readonly midi: number; readonly fromMs: number; readonly untilMs: number }[];
  readonly velocity: number;
  readonly lengthMs: number;
  readonly headAfterMs: number | null;
}

/** What each goal for the next chord makes the music, said where none of the circle does. */
const GOAL_SAID: Readonly<Record<Exclude<GoalOfTheNextChord, 'release'>, string>> = {
  tension: 'tenser',
  brighter: 'brighter',
  darker: 'darker',
};

/** How many chords the way round the circle is drawn through, the one the music is on last: enough for a phrase's turn, few enough to read. */
const THE_WAY_ROUND_SHOWN = 4;

/** The chord of the circle a pointer or a key is on: a slice's, or the middle's; none off them. */
export function theChordAskedForOnTheCircle(target: EventTarget | null): ChordAskedFor | null {
  if (isTheMiddleOfTheCircle(target)) {
    return { inTheMiddle: true };
  }
  const place = thePlaceOnTheCircle(target);
  return place === null ? null : { onTheCircle: place };
}

/** What a chord's keys are called: the chord they make, or where they make none, each key's name. */
export function theNameOfTheKeys(midis: readonly number[], fifths: number): string {
  return nameTheChord(midis, fifths) ?? eachKeyOnce(midis).map((midi) => nameOfThePitchClass(midi, fifths)).join(' ');
}

/**
 * The notes heard in a chord of the lane: its own, and those held into it
 * from before - heard whole, though only its own are chosen with it.
 */
function theNotesHeardInTheChord(roll: RunRoll, chord: SceneChord): readonly RolledPress[] {
  return [...theNotesOfTheChord(roll, chord.fromMs, chord.untilMs), ...theNotesHeldIntoTheChord(roll, chord.fromMs, chord.untilMs)];
}

/** Whether two chords asked for are the same one. */
function theSameChordAskedFor(one: ChordAskedFor | null, other: ChordAskedFor | null): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

/** How loud a note is written: as the sketch's notes are on the whole, and moderately where it has none. */
export function theUsualLoudness(events: readonly MidiFileEvent[]): number {
  const loudness = events.flatMap((event) => (event.kind === 'noteOn' ? [event.velocity] : [])).sort((a, b) => a - b);
  return loudness[Math.floor(loudness.length / 2)] ?? 0.7;
}

/**
 * What the chords beside the drawing ask of the view: the music shown and
 * its keys, the head, the sketch and writing into it, and painting again.
 */
export type TheViewOfTheChords = Pick<
  AppView,
  | 'changeTheSketchShowing'
  | 'circleDrawing'
  | 'circleKeys'
  | 'doc'
  | 'drawnScene'
  | 'el'
  | 'headIsAtMs'
  | 'paintTheRoll'
  | 'putTheHeadAt'
  | 'runtime'
  | 'sketchEditing'
  | 'theDrumsAreWritten'
  | 'theKeyAtTheCursor'
  | 'theKeyAtTheHead'
  | 'theKeyTheDrawingSpellsIn'
  | 'theKeysHeld'
  | 'theKeysOfTheMusicAreKnown'
  | 'theKeysWrittenAtTheHead'
  | 'theOtherRollShowing'
  | 'thePointOnTheDrawing'
  | 'theRoll'
  | 'theRollsGrid'
  | 'theSectionsOfTheMusicShown'
  | 'theSketchAsDrawn'
  | 'whatKeepingWouldDo'
>;

/**
 * The chords beside the drawing: the drawer of the chords of the key and
 * the reader's own, the circle of fifths and the keys under it, the chart
 * and its curves, the goal of the next chord, a draft - and the chords
 * named in the lane under the notes, chosen, heard and written over.
 *
 * Its own state is what is open, what the pointer is on or holds, and what
 * was last drawn; the sketch, its drawing and the head stay the view's,
 * asked of it through `TheViewOfTheChords`.
 */
export class ChordsBeside {
  private readonly host: TheViewOfTheChords;
  /** What the circle was last written to show, so a step of a playback that changes nothing writes nothing. */
  private circleShows = '';
  /** The keys of the chord last tapped in the lane, sounding for a moment: see `soundTheChordTapped`. */
  private chordTappedSounds: readonly number[] = [];
  /**
   * A chord drafted on the keys under the circle to write over the chord of
   * the lane chosen - the one beginning where this says - as the pitches
   * pressed into it there; none while nothing is drafted. Only that chord's:
   * see `theDraft`.
   */
  chordDraft: { readonly overFromMs: number; readonly pitchClasses: readonly number[] } | null = null;
  /**
   * The chord the pointer is on, whose notes are shown where it would write
   * them; or none.
   */
  private chordPointedAt: ChordAskedFor | null = null;
  /** Those notes, where they would go: painted dashed over the drawing until the pointer leaves the chord. */
  notesShownAhead: readonly NoteShownAhead[] = [];
  /**
   * Whether the drawer of the chords of the key is open beside a sketch being
   * edited: kept from one sketch to the next, as a tool laid out on the desk.
   */
  chordsOfTheKeyOpen = false;
  /** What the next chord should do, asked of the circle; none while nothing is. */
  goalOfTheNextChord: GoalOfTheNextChord | null = null;
  /** Whether the chart of the chords is open over the drawing, while the chords are; and what it last drew. */
  chartOpen = false;
  private chartShows = '';
  /** Whether a tap on a chord kept in the drawer deletes it, rather than writing it. */
  chordsBeingForgotten = false;
  /**
   * Where the chord last tapped in the lane begins: a chord of the drawer is
   * written over it while its notes are the ones chosen, and nothing else
   * (see `theChordChosenInTheLane`). Only a tap there says so - the notes of
   * a chord just written are chosen too, and the next one tapped follows
   * them rather than replacing them.
   */
  private chordTappedAt: number | null = null;
  /**
   * The chord of the drawer or the circle a pointer is held down on,
   * sounding until it is let go of, or none where the pointer has slid off
   * the chords; its keys, and when they were struck. And what its moving
   * is, once it moves (see `A_FINGER_LISTENS_MS`): a slide over the chords,
   * or the column scrolled, from where it was and where the pointer went
   * down.
   */
  chordHeld: {
    readonly pointerId: number;
    readonly at: ChordAskedFor | null;
    readonly keys: readonly number[];
    readonly struckAtMs: number;
    readonly downAtMs: number;
    readonly downY: number;
    readonly scrolledFrom: number;
    readonly moving: 'not yet' | 'slides' | 'scrolls';
  } | null = null;

  constructor(host: TheViewOfTheChords) {
    this.host = host;
  }

  /** Says on its button in free play whether the chord held is named, and what a press does. */
  showWhetherTheChordIsNamed(): void {
    const named = this.host.runtime.controller.settings.circleNamesTheChord;
    const button = this.host.el.focusChordNames;
    button.setAttribute('aria-pressed', String(named));
    button.title = named ? 'The chord held is named: press to hide it' : 'The chord held is not named: press to name it';
    button.setAttribute('aria-label', button.title);
  }

  /**
   * The name of the chord the chosen notes make, over the drawing, wherever
   * in time each is: a chord broken into a figure is still that chord - and
   * one with a melody passing over it is mostly that chord, said with "≈",
   * each note weighing as long as it sounds (see `theChordTheNotesMake`).
   * Spelled as a sketch's key spells its black keys. Not there while they
   * make none with a name - and on a sketch none is chosen but while it is
   * edited.
   */
  nameTheChosenChord(): void {
    const roll = this.host.theRoll();
    const chosen = this.host.sketchEditing.theNotesChosen();
    // How long each sounds, off the drawing: a key still down when the run ended, to its end.
    const lengthOf = new Map<string, number>();
    if (roll !== null && chosen.length > 0) {
      const ended = rollEndedAtMs(roll);
      for (const press of roll.presses) {
        lengthOf.set(`${String(press.midi)} ${String(press.downAtMs)}`, (press.upAtMs ?? ended) - press.downAtMs);
      }
    }
    const spelling = this.host.theKeyTheDrawingSpellsIn();
    const chord = this.host.theDrumsAreWritten()
      ? null
      : theChordTheNotesMake(
          chosen.map((key) => ({ midi: key.midi, lengthMs: lengthOf.get(`${String(key.midi)} ${String(key.downAtMs)}`) ?? 0 })),
          spelling?.fifths ?? null,
          spelling?.scale,
        );
    this.host.el.rollChord.textContent = chord === null ? '' : chord.exactly ? chord.name : `≈ ${chord.name}`;
    this.host.el.rollChord.title =
      chord?.exactly === false ? 'The chord most of the chosen notes make, by how long they sound' : 'The chord the chosen notes make';
    this.host.el.rollChord.hidden = chord === null;
  }

  /**
   * Names the chord the keys held make, on any input and on the strip beside
   * the drawing. Not there while they make none with a name, nor while the
   * circle is open, which names it in its middle.
   */
  nameTheChordHeld(): void {
    const spelling = this.host.theKeyTheDrawingSpellsIn();
    const chord = nameTheChord(this.host.theKeysHeld(), spelling?.fifths ?? null, spelling?.scale);
    this.host.el.rollChordHeldName.textContent = chord ?? '';
    this.host.el.rollChordHeld.hidden = chord === null || this.theChordsOfTheKeyAreOpen();
  }

  /**
   * The chords the drawer offers for a sketch: the key's seven, then the
   * writer's own kept ones, each with what its button says under its name -
   * the key's numeral, or the bass of one kept.
   */
  private theChordsInTheDrawer(key: SketchKey): readonly ChordInTheDrawer[] {
    const { fifths } = key;
    const ofTheKey = theChordsOfTheScale(fifths, theScaleOfTheKey(key)).map(
      ({ name, numeral, midis }): ChordInTheDrawer => ({ name, under: numeral, midis, kept: false }),
    );
    const kept = this.host.runtime.sketches.keptChords().map(
      (midis): ChordInTheDrawer => ({
        name: theNameOfTheKeys(midis, fifths),
        under: midiToLabel(Math.min(...midis)),
        midis,
        kept: true,
      }),
    );
    return [...ofTheKey, ...kept];
  }

  /**
   * The drawer of chords, open beside a sketch being edited once asked for:
   * a button for each chord, its name and what is under it, built again only
   * when the key or the chords kept change, so a finger on one is not lost
   * from under it by a change it made; and its copy, paste and keep, which
   * the notes chosen decide.
   */
  showTheChordsOfTheKey(): void {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const open = this.theChordsOfTheKeyAreOpen();
    const written = this.theChordsAreWritten();
    // There for any music whose keys are known; read only, but beside a sketch being edited.
    this.host.el.rollChordsOpen.hidden = !this.host.theKeysOfTheMusicAreKnown();
    this.host.el.rollChordsOpen.setAttribute('aria-pressed', String(this.chordsOfTheKeyOpen));
    this.host.el.rollChordsOpen.title = this.chordsOfTheKeyOpen
      ? 'Put the chords away'
      : written
        ? 'Chords, to write where the cursor is'
        : 'The chords of the music: the circle of fifths and their chart';
    this.host.el.rollChordsOpen.setAttribute('aria-label', this.host.el.rollChordsOpen.title);
    if (this.host.theDrumsAreWritten()) {
      sayWhetherIdle(this.host.el.rollChordsOpen, 'The chords are of the notes: back to them to see the chords', true);
    } else {
      delete this.host.el.rollChordsOpen.dataset['idle'];
    }
    this.host.el.rollSide.hidden = !open;
    // What writes - the drawer, the goals, the circle's slices - only where it can.
    this.host.el.rollSide.dataset['writes'] = String(written);
    this.host.el.rollChords.hidden = !written;
    if (!open || !written || stored === null || sketch === undefined) {
      this.pointAtTheChord(null);
      return;
    }
    const keyHere = this.host.theKeyAtTheHead(stored);
    const { fifths } = keyHere;
    // Nothing kept, nothing to delete: the deleting ends with the last of them.
    const anyKept = this.host.runtime.sketches.keptChords().length > 0;
    this.chordsBeingForgotten = this.chordsBeingForgotten && anyKept;
    const forgetting = this.chordsBeingForgotten;
    this.host.el.rollChordsForget.setAttribute('aria-pressed', String(forgetting));
    sayWhetherIdle(
      this.host.el.rollChordsForget,
      forgetting
        ? 'Done deleting chords'
        : anyKept
          ? 'Delete chords you kept: then a tap on one deletes it'
          : 'Delete chords you kept. None is kept yet.',
      !anyKept,
    );
    this.host.el.rollChordsList.dataset['forgetting'] = String(forgetting);
    const over = this.theChordChosenInTheLane();
    const shows = `${String(fifths)}:${theScaleOfTheKey(keyHere)} ${JSON.stringify(this.host.runtime.sketches.keptChords())} ${String(forgetting)} ${over?.name ?? ''}`;
    if (this.host.el.rollChordsList.dataset['shows'] !== shows) {
      this.host.el.rollChordsList.dataset['shows'] = shows;
      this.host.el.rollChordsList.replaceChildren(
        ...this.theChordsInTheDrawer(keyHere).map((chord, at) => {
          const button = this.host.doc.createElement('button');
          button.type = 'button';
          button.className = chord.kept ? 'button roll-chords__chord roll-chords__chord--kept' : 'button roll-chords__chord';
          button.dataset['chord'] = String(at);
          button.title = !forgetting
            ? over !== null
              ? `Make the chosen ${over.name} ${chord.name} (${chord.under}), moving its notes as little as they can`
              : `Write ${chord.name} (${chord.under}) where the cursor is, to the next line of the grid`
            : chord.kept
              ? `Delete ${chord.name} (${chord.under}) from the chords kept`
              : `${chord.name} is the key's own, and is not deleted`;
          button.setAttribute('aria-label', button.title);
          const name = this.host.doc.createElement('span');
          name.className = 'roll-chords__name';
          name.textContent = chord.name;
          const under = this.host.doc.createElement('span');
          under.className = 'roll-chords__numeral';
          under.textContent = forgetting && chord.kept ? '\u00d7' : chord.under;
          button.append(name, under);
          return button;
        }),
      );
    }

    const keeping = this.host.whatKeepingWouldDo();
    this.host.el.rollChordsKeep.textContent = keeping.lettingGo ? '\u2212' : '+';
    sayWhetherIdle(this.host.el.rollChordsKeep, keeping.says, keeping.idle);
    // The cursor moved on, the chords of another key, or the drawer deleting: what is shown ahead follows.
    if (this.chordPointedAt !== null) {
      this.showTheChordAhead();
    }
  }

  /**
   * Breaks each chosen chord into one key a step of the grid as it is drawn,
   * over the chord's length: one change, put back as one, and the keys it
   * became chosen, to be broken another way after an undo or moved.
   */
  breakTheChosenChords(way: ArpeggioWay): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    const lines = theMusicsBeats(showing.roll, this.host.theRollsGrid()).map((line) => line.atMs);
    const broken = takeWithTheChordsBroken(stored.events, sketch.chosen, lines, way);
    if (broken !== null) {
      this.host.changeTheSketchShowing(broken.events, [...sketch.before, asItWas(stored, sketch.chosen)], broken.keys);
    }
  }

  /**
   * Whether the chords are open beside the drawing: asked for, of music
   * whose keys are known - a sketch's, or the open score's.
   */
  theChordsOfTheKeyAreOpen(): boolean {
    return this.chordsOfTheKeyOpen && this.host.theKeysOfTheMusicAreKnown() && !this.host.theDrumsAreWritten();
  }

  /** Whether the chords open are written with as well as read: only beside a sketch being edited. */
  private theChordsAreWritten(): boolean {
    const sketch = this.host.theOtherRollShowing?.sketch;
    return sketch?.editing === true && this.host.theSketchAsDrawn(sketch.id) !== null;
  }

  /**
   * Deletes a chord of the drawer the writer kept. One of the key's own is
   * never among those kept - the keep button will not keep one - so asked of
   * one, nothing goes.
   */
  forgetTheChordInTheDrawer(at: number): void {
    const stored = this.host.theOtherRollShowing?.sketch === undefined ? null : this.host.theSketchAsDrawn(this.host.theOtherRollShowing.sketch.id);
    const chord = stored === null ? undefined : this.theChordsInTheDrawer(this.host.theKeyAtTheHead(stored))[at];
    if (chord === undefined) {
      return;
    }
    this.host.runtime.sketches.letGoOfTheChord(chord.midis);
    this.showTheChordsOfTheKey();
  }

  /** Keeps the chosen notes as a chord, or lets go of the kept chord they are. */
  keepOrLetGoOfTheChosenChord(): void {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const keeping = this.host.whatKeepingWouldDo();
    if (sketch === undefined || keeping.idle) {
      return;
    }
    const chosen = sketch.chosen.map((key) => key.midi);
    if (keeping.lettingGo) {
      this.host.runtime.sketches.letGoOfTheChord(chosen);
    } else {
      this.host.runtime.sketches.keepTheChord(chosen);
    }
    this.showTheChordsOfTheKey();
  }

  /**
   * Writes a chord of the drawer into the sketch where the cursor is - from
   * the line of the grid it is in where the marker is put on one - to the
   * next line, as loud as the sketch is on the whole: one change, put back as
   * one, heard as it is written, and chosen, to be moved where it was not
   * quite meant. The cursor goes on to where it ends, so the next chord tapped
   * follows it, and a progression is written by tapping it through. A key of
   * it already sounding there is left out, as a paste leaves it.
   */
  writeTheChordAtTheHead(at: ChordAskedFor): ChordWritten | null {
    return this.writeTheChordWritten(this.theChordAskedForWritten(at));
  }

  /** Writes what a chord would make of the sketch, as `writeTheChordAtTheHead` says; what was written, or none. */
  private writeTheChordWritten(written: ChordWritten | null): ChordWritten | null {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (sketch === undefined || stored === null || written === null || !written.changes) {
      return null;
    }
    this.host.changeTheSketchShowing(written.events, [...sketch.before, asItWas(stored, sketch.chosen)], written.chosen);
    // Moved on, the cursor takes what is shown ahead with it: the chord still
    // pointed at is shown where it would go next, not where it has just gone.
    if (written.headAfterMs !== null) {
      this.host.putTheHeadAt(written.headAfterMs);
      this.showTheChordAhead();
    }
    return written;
  }

  /**
   * Strikes the chord of the drawer or the circle a pointer goes down on -
   * the mouse's left button, a finger or a pen - to sound until it is let go
   * of, and holds it there to slide over the others. Deleting, the drawer
   * only deletes: the sound is a hearing of what would be written.
   */
  holdTheChord(event: PointerEvent): void {
    const chord = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-chord]') : null;
    const asked: ChordAskedFor | null =
      chord === null ? theChordAskedForOnTheCircle(event.target) : this.chordsBeingForgotten ? null : { inTheDrawer: Number(chord.dataset['chord']) };
    if (asked === null || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    this.letGoOfTheChord(null);
    this.chordHeld = {
      pointerId: event.pointerId,
      at: null,
      keys: [],
      struckAtMs: 0,
      downAtMs: this.host.runtime.clock.now(),
      downY: event.clientY,
      scrolledFrom: this.host.el.rollChords.scrollTop,
      // A mouse scrolls with its wheel, and the circle not at all, so moving there is always a slide.
      moving: event.pointerType === 'mouse' || chord === null ? 'slides' : 'not yet',
    };
    this.strikeTheChord(asked);
  }

  /**
   * Takes the chord held to the one the pointer has slid onto, letting go of
   * the one before as a hand sliding over keys does - and to none, silent,
   * off the chords - and shows where it would be written.
   */
  slideOverTheChords(event: PointerEvent): void {
    const held = this.chordHeld;
    if (held === null) {
      return;
    }
    if (held.moving === 'not yet') {
      if (Math.abs(event.clientY - held.downY) < A_FINGER_MOVES_PX) {
        return;
      }
      // A column with nothing to scroll is slid over at once.
      const scrolls =
        this.host.el.rollChords.scrollHeight > this.host.el.rollChords.clientHeight &&
        this.host.runtime.clock.now() - held.downAtMs < A_FINGER_LISTENS_MS;
      if (scrolls) {
        // The chord struck as it came down was not asked for: silenced, and nothing written.
        this.strikeTheChord(null);
        this.pointAtTheChord(null);
      }
      this.chordHeld = { ...(this.chordHeld ?? held), moving: scrolls ? 'scrolls' : 'slides' };
    }
    if (this.chordHeld?.moving === 'scrolls') {
      this.host.el.rollChords.scrollTop = held.scrolledFrom - (event.clientY - held.downY);
      return;
    }
    const at = this.theChordUnder(event);
    if (!theSameChordAskedFor(at, this.chordHeld?.at ?? null)) {
      this.strikeTheChord(at);
      this.pointAtTheChord(at);
    }
  }

  /**
   * Silences the chord held, if one is sounding, and strikes the one asked
   * for, as loud as the sketch is on the whole: all its keys, those the
   * sketch already has there too, so the chord is heard whole.
   */
  private strikeTheChord(at: ChordAskedFor | null): void {
    const held = this.chordHeld;
    if (held === null) {
      return;
    }
    for (const midi of held.keys) {
      this.host.runtime.pitchPlayer.stop(midi);
    }
    const written = at === null ? null : this.theChordAskedForWritten(at);
    const keys = written === null ? [] : written.heard;
    const now = this.host.runtime.clock.now();
    for (const midi of keys) {
      this.host.sketchEditing.theEditingsInstrument.play(midi, written?.velocity ?? 0, now);
    }
    this.chordHeld = { ...held, at: written === null ? null : at, keys, struckAtMs: now };
  }

  /**
   * Lets go of the chord held, writing the one the pointer is let go of on,
   * or none. Written, it sounds on for as long as it is written, so a quick
   * tap is heard as a note of it and not cut short; held longer, it ends as
   * it is let go of. Its one strike is the hearing: the writing strikes
   * nothing again.
   */
  letGoOfTheChord(at: ChordAskedFor | null): void {
    const held = this.chordHeld;
    if (held === null) {
      return;
    }
    this.chordHeld = null;
    const written = at === null ? null : this.writeTheChordAtTheHead(at);
    const endsAtMs = Math.max(this.host.runtime.clock.now(), held.struckAtMs + (written?.lengthMs ?? 0));
    for (const midi of held.keys) {
      this.host.runtime.pitchPlayer.stop(midi, endsAtMs);
    }
  }

  /** The chord of the drawer or the circle under a point; `null` off the chords. */
  theChordUnder(event: PointerEvent): ChordAskedFor | null {
    const under = this.host.doc.elementFromPoint(event.clientX, event.clientY);
    const chord = under?.closest<HTMLElement>('[data-chord]') ?? null;
    return chord === null ? theChordAskedForOnTheCircle(under) : this.chordsBeingForgotten ? null : { inTheDrawer: Number(chord.dataset['chord']) };
  }

  /**
   * What a chord asked for would make of the sketch: see
   * `theChordWrittenAtTheHead`. None for one of the drawer while it is
   * deleting what it keeps, since a press there then writes nothing.
   */
  private theChordAskedForWritten(at: ChordAskedFor): ChordWritten | null {
    if ('inTheDrawer' in at) {
      return this.chordsBeingForgotten ? null : this.theChordWrittenAtTheHead(at.inTheDrawer);
    }
    const keys = 'onTheCircle' in at ? theKeysAtThePlace(at.onTheCircle) : (this.theChordSounding()?.keys ?? null);
    return keys === null ? null : this.host.theKeysWrittenAtTheHead(keys);
  }

  /**
   * The chord drafted on the keys under the circle, as its pitch classes:
   * only while the chord it is to be written over is still the one chosen
   * in the lane, so choosing another, or none, leaves no draft behind.
   */
  theDraft(): readonly number[] | null {
    const draft = this.chordDraft;
    const over = draft === null ? null : this.theChordChosenInTheLane();
    return over !== null && draft !== null && over.fromMs === draft.overFromMs ? draft.pitchClasses : null;
  }

  /**
   * The keys a draft is written and heard as: its pitches upward from the
   * root of the chord chosen, from middle C's octave - so a draft of the
   * chord's own notes is in its own root position, and named as itself
   * rather than over whichever of them is nearest C.
   */
  theKeysOfTheDraft(pitchClasses: readonly number[]): readonly number[] {
    const root = this.theChordChosenInTheLane()?.root ?? 0;
    return pitchClasses.map((pitchClass) => MIDDLE_C + root + ((((pitchClass - root) % 12) + 12) % 12));
  }

  /**
   * Writes the draft over the chosen chord, as a chord of the circle is
   * written over it - its notes moved as little as they can - and heard; the
   * chord stays chosen, to draft another over it.
   */
  writeTheDraft(): void {
    const draft = this.theDraft();
    if (draft === null || draft.length < A_DRAFT_HAS_AT_LEAST) {
      return;
    }
    this.chordDraft = null;
    this.soundTheChordWritten(this.writeTheChordWritten(this.host.theKeysWrittenAtTheHead(this.theKeysOfTheDraft(draft))));
    this.showTheCircle();
  }

  /** A chord as named and numbered in the key the cursor is in, from its keys; none where they make none. */
  private theChordOfTheKeys(keys: readonly number[]): {
    readonly name: string;
    readonly numeral: string;
    readonly root: number;
    readonly kind: ChordKind;
    readonly keys: readonly number[];
  } | null {
    const key = this.host.theKeyAtTheCursor();
    const made = key === null ? null : theChordTheKeysMake(keys, key.fifths, key.scale);
    if (key === null || made === null) {
      return null;
    }
    const numeral = theNumeralOfTheChord(made, key);
    return { name: made.name, numeral, root: made.root, kind: made.kind, keys };
  }

  /**
   * The chord sounding, as the middle of the circle names it: the one
   * drafted on the keys under it while there is a draft; the one the keys
   * held make, where they make one, as they are held and numbered in the
   * key the cursor is in, as the lane numbers the music there; and
   * otherwise the one the lane names at the cursor, its root in the octave
   * of middle C. None where the music's keys are not known.
   */
  private theChordSounding(): {
    readonly name: string;
    readonly numeral: string;
    readonly root: number;
    readonly kind: ChordKind;
    readonly keys: readonly number[];
  } | null {
    const draft = this.theDraft();
    if (draft !== null) {
      return this.theChordOfTheKeys(this.theKeysOfTheDraft(draft));
    }
    const held = this.theChordOfTheKeys([...new Set(this.host.theKeysHeld())]);
    if (held !== null) {
      return held;
    }
    const scene = this.host.drawnScene;
    const chord = scene === null ? null : theChordAt(scene, this.host.headIsAtMs());
    return chord === null
      ? null
      : { name: chord.name, numeral: chord.numeral, root: chord.root, kind: chord.kind, keys: theKeysOfTheChord(chord.root, chord.kind) };
  }

  /**
   * What a chord of the drawer would make of the sketch: written over the
   * chord chosen in the lane, where one is (see `theChordWrittenOver`), and
   * where the cursor is otherwise - its notes from the line of the grid the
   * cursor is in, where the marker is put on one, to the next, as loud as
   * the sketch is on the whole, the cursor going on to where they end. One
   * answer, for writing it, hearing it and showing it ahead.
   */
  private theChordWrittenAtTheHead(at: number): ChordWritten | null {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const chord = stored === null ? undefined : this.theChordsInTheDrawer(this.host.theKeyAtTheHead(stored))[at];
    return chord === undefined ? null : this.host.theKeysWrittenAtTheHead(chord.midis);
  }

  /**
   * The chord tapped in the lane, while the notes chosen are its notes and
   * nothing else - what a chord of the drawer is written over rather than at
   * the cursor; `null` where the choice is anything else. Read off the
   * choice each time it is asked, so it is never out of step with it.
   */
  theChordChosenInTheLane(): SceneChord | null {
    const scene = this.host.drawnScene;
    const roll = this.host.theRoll();
    const sketch = this.host.theOtherRollShowing?.sketch;
    const at = this.chordTappedAt;
    const chord = scene === null || at === null ? null : theChordAt(scene, at);
    if (chord === null || !chord.chosen || roll === null || sketch === undefined) {
      return null;
    }
    return theNotesOfTheChord(roll, chord.fromMs, chord.untilMs).length === sketch.chosen.length ? chord : null;
  }

  /**
   * A chord of the drawer written over a chord of the lane: its notes moved
   * to the drawer's, as a hand moves from one chord to the next (see
   * `theChordMovedTo`), in the time and the rhythm they have. Only the
   * notes that make the chord move - those that are its tones - and of
   * those, where both hands play in it, only the left hand's, which carry
   * it: a melody over it is the right hand's, and stays. The whole chord
   * stays chosen and the cursor where it begins, so another can be tried
   * over it at once.
   */
  theChordWrittenOver(over: SceneChord, drawn: readonly number[]): ChordWritten | null {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const roll = this.host.theRoll();
    const to = theChordTheNotesMake(drawn.map((midi) => ({ midi, lengthMs: 1 })));
    if (stored === null || roll === null || to === null) {
      return null;
    }
    const origin = rollBeganAtMs(roll);
    const notes = theNotesOfTheChord(roll, over.fromMs, over.untilMs);
    const bothHands = new Set(notes.map((note) => theHandThatPlays(note))).size > 1;
    const tones = new Set(over.kind.intervals.map((step) => (over.root + step) % 12));
    const moving = notes.filter(
      (note) => (!bothHands || theHandThatPlays(note) === 'left') && tones.has(((note.midi % 12) + 12) % 12),
    );
    const moved = theChordMovedTo(
      moving.map((note) => note.midi),
      to,
      notes.filter((note) => !moving.includes(note)).map((note) => note.midi),
    );
    const changing = moving.filter((note) => (moved.get(note.midi) ?? note.midi) !== note.midi);
    const events =
      changing.length === 0
        ? stored.events
        : takeWithTheKeysChanged(
            stored.events,
            changing.map((note) => ({
              key: { midi: note.midi, downAtMs: note.downAtMs },
              midi: moved.get(note.midi) ?? note.midi,
              downAtMs: note.downAtMs,
              upAtMs: note.upAtMs,
            })),
          );
    if (events === null) {
      return null;
    }
    const endMs = rollEndedAtMs(roll);
    const heard = [...new Set(moving.map((note) => moved.get(note.midi) ?? note.midi))].sort((low, high) => low - high);
    return {
      changes: changing.length > 0,
      heard,
      struck: heard,
      events,
      chosen: notes.map((note) => ({ midi: moved.get(note.midi) ?? note.midi, downAtMs: note.downAtMs })),
      shown: changing.map((note) => ({
        midi: moved.get(note.midi) ?? note.midi,
        fromMs: note.downAtMs - origin,
        untilMs: (note.upAtMs ?? endMs) - origin,
      })),
      velocity: theUsualLoudness(stored.events),
      lengthMs: over.untilMs - over.fromMs,
      headAfterMs: null,
    };
  }

  /** Sounds the keys a chord written put in, for as long as it is written: a chord pressed by a key, or tapped on the circle. */
  soundTheChordWritten(written: ChordWritten | null): void {
    const now = this.host.runtime.clock.now();
    for (const midi of written === null ? [] : written.struck) {
      this.host.sketchEditing.theEditingsInstrument.play(midi, written?.velocity ?? 0, now);
      this.host.runtime.pitchPlayer.stop(midi, now + (written?.lengthMs ?? 0));
    }
  }

  /**
   * The circle of fifths, open with the chords beside a sketch being edited:
   * the key the cursor is in lit, with its numerals, and the chord sounding
   * named in the middle with its numeral, and lit more - the keys held where they make one,
   * otherwise the chord the music makes where the cursor is, the one the
   * lane under the notes names there - with the way the music came to it
   * drawn fading behind, so a playback is watched going round it. The keys
   * held take no step of the way: they are not the music. Asked on every
   * step of a playback and every key, and written only when what it shows
   * has changed.
   */
  showTheCircle(): void {
    const open = this.theChordsOfTheKeyAreOpen();
    const key = this.host.theKeyAtTheCursor();
    if (!open || key === null) {
      return;
    }
    const scene = this.host.drawnScene;
    const chord = this.theChordSounding();
    const here = chord === null ? null : whereOnTheCircle(chord.root, chord.kind);
    const sounding = chord === null ? null : { name: chord.name, numeral: chord.numeral };
    const named = this.host.runtime.controller.settings.circleNamesTheChord;
    this.host.el.rollCircleNames.setAttribute('aria-pressed', String(named));
    this.host.el.rollCircleNames.title = named
      ? 'The chord sounding is named in the middle: press to hide it'
      : 'The chord sounding is not named in the middle: press to name it';
    this.host.el.rollCircleNames.setAttribute('aria-label', this.host.el.rollCircleNames.title);
    const onTheKeys = this.host.runtime.controller.settings.circleShowsTheKeys;
    this.host.el.rollCircleKeysShown.setAttribute('aria-pressed', String(onTheKeys));
    this.host.el.rollCircleKeysShown.title = onTheKeys
      ? 'The chord sounding is shown on the keys under the circle: press to hide them'
      : 'The keys under the circle are hidden: press to show the chord sounding on them';
    this.host.el.rollCircleKeysShown.setAttribute('aria-label', this.host.el.rollCircleKeysShown.title);
    this.host.el.rollCircleKeys.hidden = !onTheKeys;
    // Pressed to draft another over the chord chosen in the lane, while one is.
    const draft = this.theDraft();
    const drafts = this.theChordChosenInTheLane() !== null;
    this.host.el.rollCircleKeys.dataset['drafts'] = String(drafts);
    this.host.el.rollCircleKeys.dataset['draft'] = String(draft !== null);
    this.host.el.rollCircleKeys.title = drafts ? 'Press keys to make the chosen chord another, heard as it changes' : '';
    // While they draft, each key is a button a key reaches, saying whether its note is in the chord drafted.
    const chosenInTheLane = this.theChordChosenInTheLane();
    const drafted = new Set(
      draft ?? (chosenInTheLane === null ? [] : theKeysOfTheChord(chosenInTheLane.root, chosenInTheLane.kind).map((each) => each % 12)),
    );
    for (const [midi, pressable] of this.host.circleKeys) {
      if (drafts) {
        const name = nameOfThePitchClass(midi, key.fifths);
        const inIt = drafted.has(midi % 12);
        pressable.tabIndex = 0;
        pressable.setAttribute('role', 'button');
        pressable.setAttribute('aria-pressed', String(inIt));
        pressable.setAttribute('aria-label', inIt ? `${name}, in the chord: press to leave it out` : `${name}: press to put it in the chord`);
      } else {
        pressable.removeAttribute('tabindex');
        pressable.removeAttribute('role');
        pressable.removeAttribute('aria-pressed');
        pressable.removeAttribute('aria-label');
      }
    }
    this.host.el.rollCircleDraft.hidden = draft === null;
    sayWhetherIdle(
      this.host.el.rollCircleDraftYes,
      draft !== null && draft.length < A_DRAFT_HAS_AT_LEAST
        ? 'Write this chord over the chosen one. A chord has two notes at least.'
        : 'Write this chord over the chosen one',
      draft !== null && draft.length < A_DRAFT_HAS_AT_LEAST,
    );
    // And the room they take given back to the circle: see `--circle-keys`.
    this.host.el.rollCircle.dataset['keys'] = String(onTheKeys);
    const way = scene === null ? [] : theWayRoundTheCircle(scene.chords, this.host.headIsAtMs(), THE_WAY_ROUND_SHOWN);
    const hints = this.theChordsOffered();
    const writes = this.theChordsAreWritten();
    const shows = JSON.stringify([key.fifths, key.scale, here, sounding, chord?.keys, draft, named, way, hints, writes]);
    if (shows === this.circleShows) {
      return;
    }
    this.circleShows = shows;
    // A draft that makes no chord yet still shows its keys, with no root.
    showTheChordOnTheKeys(
      this.host.circleKeys,
      chord ?? (draft === null ? null : { root: Number.NaN, keys: this.theKeysOfTheDraft(draft) }),
    );
    showOnTheCircle(this.host.circleDrawing, {
      fifths: key.fifths,
      ofTheKey: theKeysOwnPlaces(key.fifths, key.scale),
      writes,
      here,
      sounding,
      named,
      way,
      hints,
    });
  }

  /**
   * The chord the next one goes on from: the last of the lane begun before
   * where it would be written - before the chord chosen, where one is, which
   * it would be written over, and before the cursor otherwise.
   */
  private theChordBeforeTheNext(): SceneChord | null {
    const scene = this.host.drawnScene;
    const until = this.theChordChosenInTheLane()?.fromMs ?? this.host.headIsAtMs();
    return scene?.chords.filter((chord) => chord.fromMs < until).at(-1) ?? null;
  }

  /**
   * The chords of the circle offered as the next, with what each would do
   * (see `theChordsTowards`), for the goal asked: after the chord before the
   * next, in its own key. And says over the drawer what it was asked, and
   * why there is nothing where there is nothing.
   */
  private theChordsOffered(): readonly { readonly place: PlaceOnTheCircle; readonly says: string }[] {
    const goal = this.goalOfTheNextChord;
    for (const button of this.host.el.rollGoals) {
      button.setAttribute('aria-pressed', String(button.dataset['goal'] === goal));
    }
    const before = goal === null ? null : this.theChordBeforeTheNext();
    const hints = goal === null || before === null ? [] : theChordsTowards(goal, before, before.key);
    const was = before === null ? null : { tension: theTensionOfTheChord(before, before.key), brightness: theBrightnessOfTheChord(before, before.key) };
    this.host.el.rollGoalsSays.hidden = goal === null;
    this.host.el.rollGoalsSays.textContent =
      goal === null
        ? ''
        : before === null
          ? 'No chord before the cursor to go on from.'
          : hints.length > 0
            ? `After ${before.name}:`
            : goal === 'release'
              ? `Nothing to let go: ${before.name} is at rest already.`
              : `No chord of the circle makes it ${GOAL_SAID[goal]} after ${before.name}.`;
    return hints.map((hint) => ({
      place: hint.place,
      says: `Tension ${(was?.tension ?? 0).toFixed(1)} to ${hint.tension.toFixed(1)}, brightness ${(was?.brightness ?? 0).toFixed(1)} to ${hint.brightness.toFixed(1)}.`,
    }));
  }

  /**
   * The chart of the chords, over the drawing while it is open with the
   * chords: drawn again only when the chords or the bars have changed, and
   * the chord the cursor is in marked on every step of a playback.
   */
  showTheChart(): void {
    const withTheChords = this.theChordsOfTheKeyAreOpen();
    this.host.el.rollChartOpen.hidden = !withTheChords;
    this.host.el.rollChartOpen.setAttribute('aria-pressed', String(this.chartOpen));
    this.host.el.rollChartOpen.title = this.chartOpen ? 'Back to the notes' : 'The chart of the chords';
    this.host.el.rollChartOpen.setAttribute('aria-label', this.host.el.rollChartOpen.title);
    const scene = this.host.drawnScene;
    const open = withTheChords && this.chartOpen && scene !== null;
    this.host.el.rollChart.hidden = !open;
    if (!open) {
      return;
    }
    const chart = theChartOfTheChords(scene.bars, scene.chords, this.host.theSectionsOfTheMusicShown());
    const shows = JSON.stringify(chart);
    if (shows !== this.chartShows) {
      this.chartShows = shows;
      drawTheChart(this.host.el.rollChart, chart, theCurvesOfTheChords(scene.chords));
    }
    showWhereOnTheChart(this.host.el.rollChart, this.host.headIsAtMs());
  }

  /** Points at a chord, or at none, and shows its notes where it would write them. */
  pointAtTheChord(at: ChordAskedFor | null): void {
    this.chordPointedAt = at;
    this.showTheChordAhead();
  }

  /**
   * Shows the notes of the chord pointed at where it would write them - the
   * keys it would put in, and none already sounding there - or, for one of
   * the drawer, none while the drawer is deleting what it keeps, since a
   * press there then writes nothing. Put away, it points at none.
   */
  private showTheChordAhead(): void {
    const pointed = this.chordPointedAt;
    const scene = this.host.drawnScene;
    const written = pointed === null || scene === null ? null : this.theChordAskedForWritten(pointed);
    this.notesShownAhead =
      written === null || scene === null
        ? []
        : written.shown.map((key) => ({ row: scene.highest - key.midi, fromMs: key.fromMs, untilMs: key.untilMs }));
    this.host.paintTheRoll();
  }

  /**
   * Chooses the notes of the chord tapped in the lane - added to those
   * chosen, with a key held, as a note tapped is - and puts the marker where
   * the chord begins, to be heard from there. Says whether there was one.
   */
  chooseTheChordTapped(event: MouseEvent): boolean {
    const scene = this.host.drawnScene;
    const at = this.host.thePointOnTheDrawing(event);
    const chord = scene === null || at === null ? null : theChordAt(scene, at.atMs);
    return chord !== null && this.pressTheChordOfTheLane(chord, event.ctrlKey || event.metaKey || event.shiftKey);
  }

  /**
   * A chord of the lane tapped there or pressed on the chart: chosen where
   * the sketch is edited (see `chooseTheChordOfTheLane`); and anywhere else
   * - a score read, a sketch listened to - the cursor put where it begins.
   * Heard either way. Says whether there was a drawing to do it in.
   */
  pressTheChordOfTheLane(chord: SceneChord, adds: boolean): boolean {
    if (this.chooseTheChordOfTheLane(chord, adds)) {
      return true;
    }
    const roll = this.host.theRoll();
    if (roll === null) {
      return false;
    }
    this.host.putTheHeadAt(chord.fromMs);
    this.soundTheChordTapped(theNotesHeardInTheChord(roll, chord), chord.untilMs - chord.fromMs);
    return true;
  }

  /**
   * Chooses the notes of a chord of the lane - tapped there, or pressed on
   * the chart of the chords - added to those chosen where asked, puts the
   * marker where it begins, and sounds it: chosen so, a chord of the drawer
   * or of the circle is written over it. Says whether it could.
   */
  private chooseTheChordOfTheLane(chord: SceneChord, adds: boolean): boolean {
    const roll = this.host.theRoll();
    const sketch = this.host.theOtherRollShowing?.sketch;
    if (roll === null || sketch?.editing !== true) {
      return false;
    }
    const notes = theNotesOfTheChord(roll, chord.fromMs, chord.untilMs).map((press) => ({ midi: press.midi, downAtMs: press.downAtMs }));
    const heard = theNotesHeardInTheChord(roll, chord);
    this.host.sketchEditing.choose(adds ? [...sketch.chosen.filter((key) => !notes.some((note) => sameKey(note, key))), ...notes] : notes);
    this.chordTappedAt = chord.fromMs;
    this.showTheChordsOfTheKey();
    this.host.putTheHeadAt(chord.fromMs);
    this.soundTheChordTapped(heard, chord.untilMs - chord.fromMs);
    return true;
  }

  /**
   * Sounds the notes of a chord tapped in the lane, so it is heard as well
   * as chosen, those held into it from before as well: each pitch once, as
   * hard as it is struck hardest there, all at once, for as long as the
   * chord lasts or a moment, whichever is less. The one tapped before is
   * silenced first.
   */
  soundTheChordTapped(presses: readonly { readonly midi: number; readonly velocity: number }[], lastsMs: number): void {
    for (const midi of this.chordTappedSounds) {
      this.host.runtime.pitchPlayer.stop(midi);
    }
    const now = this.host.runtime.clock.now();
    const keys = oneKeyForEachPitch(presses);
    for (const { midi, velocity } of keys) {
      this.host.sketchEditing.theEditingsInstrument.play(midi, velocity, now);
      this.host.runtime.pitchPlayer.stop(midi, now + Math.min(lastsMs, A_CHORD_TAPPED_SOUNDS_MS));
    }
    this.chordTappedSounds = keys.map(({ midi }) => midi);
  }
}
