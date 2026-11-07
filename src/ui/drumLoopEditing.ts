import { rollBeganAtMs, theEndNearest } from '../application/session/RunRoll.js';
import {
  takeWithADrumLoop,
  takeWithTheDrumLoopUntil,
  takeWithoutTheDrumLoop,
  theDrumLoopsOf,
  type DrumLoop,
} from '../domain/midi/drumLoops.js';
import { theNotesAndTheDrumsSwapped } from '../domain/midi/drums.js';
import type { MidiFileEvent } from '../domain/midi/MidiFile.js';
import { asItWas } from './sketchEditing.js';
import type { AppView } from './AppView.js';

/** What the loops of a sketch's drums ask of the view: the sketch drawn, where things are on it, and changing it. */
export type TheViewOfTheLoops = Pick<
  AppView,
  | 'changeTheSketchShowing'
  | 'el'
  | 'headIsAtMs'
  | 'rollHeads'
  | 'runtime'
  | 'theMomentUnder'
  | 'theOtherRollShowing'
  | 'theRollsGrid'
  | 'theSketchAsDrawn'
  | 'theSliceShown'
>;

/**
 * The loops of a sketch's drums, on the drawing while its drums are written:
 * each a frame over the stretch it repeats, its first lap plain and its
 * repeats paler, and a tab at its end that pulls it out into more laps or
 * back - to the lines of the grid, so a lap may stop partway through. A loop
 * is made of the slice laid on the ruler, and let go of where the marker is
 * in one. Its laps are kept alike by `changeTheSketchShowing`.
 */
export class DrumLoopEditing {
  private readonly host: TheViewOfTheLoops;
  /** The end of a loop held by a pointer, and where it has been pulled to so far, from the sketch's beginning. */
  private heldEnd: { readonly pointerId: number; readonly loop: DrumLoop; readonly untilMs: number } | null = null;

  constructor(host: TheViewOfTheLoops) {
    this.host = host;
  }

  /** The loops of the sketch drawn, while its drums are written and edited; none otherwise. */
  theLoopsShown(): readonly DrumLoop[] {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined || !sketch.drums || !sketch.editing ? null : this.host.theSketchAsDrawn(sketch.id);
    return stored === null ? [] : theDrumLoopsOf(stored.events);
  }

  /** Draws the loops over the grid as they are, and the one being pulled where it has been pulled to. */
  showTheLoops(): void {
    const box = this.host.rollHeads?.loops;
    const roll = this.host.theOtherRollShowing?.roll;
    if (box === undefined || roll === undefined) {
      return;
    }
    const origin = rollBeganAtMs(roll);
    box.replaceChildren(
      ...this.theLoopsShown().map((loop) => {
        const untilMs = this.heldEnd?.loop.id === loop.id ? this.heldEnd.untilMs : loop.untilMs;
        const frame = box.ownerDocument.createElement('div');
        frame.className = 'roll__loop';
        frame.dataset['loop'] = String(loop.id);
        frame.style.setProperty('--roll-at', ((loop.fromMs - origin) / 1000).toFixed(3));
        frame.style.setProperty('--roll-span', ((untilMs - loop.fromMs) / 1000).toFixed(3));
        frame.style.setProperty('--roll-lap', ((loop.lapMs - loop.fromMs) / 1000).toFixed(3));
        const end = box.ownerDocument.createElement('div');
        end.className = 'roll__loop-end';
        end.title = 'Pull to repeat the loop, or back to repeat it less';
        frame.append(end);
        return frame;
      }),
    );
  }

  /** Takes hold of the end of a loop a press went down on; says whether it did. */
  takeHoldOfAnEnd(event: PointerEvent): boolean {
    const end = event.target instanceof Element ? event.target.closest<HTMLElement>('.roll__loop-end') : null;
    const id = Number(end?.closest<HTMLElement>('.roll__loop')?.dataset['loop']);
    const loop = this.theLoopsShown().find((each) => each.id === id);
    if (loop === undefined) {
      return false;
    }
    this.heldEnd = { pointerId: event.pointerId, loop, untilMs: loop.untilMs };
    return true;
  }

  /**
   * Pulls the end held to the line of the grid nearest the pointer - or the
   * half, third or quarter of a step, as a note's end goes - from the end of
   * the first lap on. Says whether one was held.
   */
  dragAnEnd(event: PointerEvent): boolean {
    const held = this.heldEnd;
    if (held === null || held.pointerId !== event.pointerId) {
      return false;
    }
    const roll = this.host.theOtherRollShowing?.roll;
    const wanted = this.host.theMomentUnder(event.clientX);
    if (roll !== undefined && wanted !== null) {
      const origin = rollBeganAtMs(roll);
      // From just before the first lap's end: that end is the nearest line it goes to, and none is short of it.
      const at = theEndNearest(roll, this.host.theRollsGrid(), held.loop.lapMs - origin - 1, wanted) + origin;
      this.heldEnd = { ...held, untilMs: at };
      this.showTheLoops();
    }
    return true;
  }

  /** Lets go of the end held, the loop pulled to where it was let go of - unless the press was taken away. Says whether one was held. */
  letGoOfAnEnd(event: PointerEvent, keep: boolean): boolean {
    const held = this.heldEnd;
    if (held === null || held.pointerId !== event.pointerId) {
      return false;
    }
    this.heldEnd = null;
    if (keep && Math.abs(held.untilMs - held.loop.untilMs) >= 1) {
      this.change((events) => takeWithTheDrumLoopUntil(events, held.loop.id, held.untilMs));
    }
    this.showTheLoops();
    return true;
  }

  /** The loop the marker is in, if it is in one. */
  private theLoopAtTheHead(): DrumLoop | null {
    const roll = this.host.theOtherRollShowing?.roll;
    if (roll === undefined) {
      return null;
    }
    const at = this.host.headIsAtMs() + rollBeganAtMs(roll);
    return this.theLoopsShown().find((loop) => at >= loop.fromMs && at < loop.untilMs) ?? null;
  }

  /** The slice laid on the ruler as moments of the sketch, if one is. */
  private theSlice(): { readonly fromMs: number; readonly toMs: number } | null {
    const roll = this.host.theOtherRollShowing?.roll;
    const slice = this.host.theSliceShown();
    return roll === undefined || slice === null
      ? null
      : { fromMs: slice.fromMs + rollBeganAtMs(roll), toMs: slice.toMs + rollBeganAtMs(roll) };
  }

  /** Lets go of the loop the marker is in, or makes a loop of the slice. */
  makeOrLetGo(): void {
    const here = this.theLoopAtTheHead();
    if (here !== null) {
      this.change((events) => takeWithoutTheDrumLoop(events, here.id));
      return;
    }
    const slice = this.theSlice();
    if (slice !== null) {
      this.change((events) => takeWithADrumLoop(events, slice.fromMs, slice.toMs) ?? events);
    }
  }

  /** Says on the button what it does here: let go of the loop at the marker, make one of the slice, or why neither. */
  sayWhatTheButtonDoes(): void {
    const button = this.host.el.rollDrumLoop;
    const here = this.theLoopAtTheHead();
    const slice = this.theSlice();
    const sketch = this.host.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    const fits = slice !== null && stored !== null && takeWithADrumLoop(stored.events, slice.fromMs, slice.toMs) !== null;
    const says =
      here !== null
        ? 'Let go of the loop at the marker: its hits stay as they are'
        : fits
          ? 'Make a loop of the slice, then pull its end to repeat it'
          : slice !== null
            ? 'Make a loop of the slice. It runs into a loop already there: lay it beside one.'
            : 'Make a loop of the drums. Lay a slice on the ruler first: hold it and drag.';
    button.title = says;
    button.setAttribute('aria-label', says);
    button.setAttribute('aria-pressed', String(here !== null));
    if (here !== null || fits) {
      delete button.dataset['idle'];
    } else {
      button.dataset['idle'] = 'true';
    }
  }

  /** Changes the drums as they are kept, one change put back as one. */
  private change(make: (events: readonly MidiFileEvent[]) => readonly MidiFileEvent[]): void {
    const sketch = this.host.theOtherRollShowing?.sketch;
    const kept = sketch === undefined ? null : this.host.runtime.sketches.find(sketch.id);
    const drawn = sketch === undefined ? null : this.host.theSketchAsDrawn(sketch.id);
    if (sketch === undefined || !sketch.drums || kept === null || drawn === null) {
      return;
    }
    const changed = make(kept.events);
    if (changed === kept.events) {
      return;
    }
    // Handed over as the drawing has it: its drums as its notes.
    this.host.changeTheSketchShowing(theNotesAndTheDrumsSwapped(changed), [...sketch.before, asItWas(drawn, sketch.chosen)]);
  }
}
