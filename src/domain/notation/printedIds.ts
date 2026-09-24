/**
 * The names every bar and note carries on the printed page.
 *
 * The engraver draws each `<measure>` and `<note>` of the MusicXML it is given
 * as an element that keeps the `id` it was written with, so naming them here
 * lets the page be read by name: the notes a step asks for, the bar a passage
 * ends in. Without names that is a map from time to notes the engraver has to
 * work out for itself, and on the longest score he owns that took 5.6 s on the
 * iPad.
 *
 * Named by where they stand in the {@link Exercise} rather than by a counter,
 * because the printed page and the timeline are both derived from the exercise
 * and never from each other: whatever knows where an entry stands can say its
 * name, without having seen the page.
 *
 * One entry is one `<note>` per pitch, and never split: a value that needs two
 * printed notes is two entries tied, so the pitch's place in its entry is the
 * whole of the name below the entry.
 */

/** Where an entry stands: the bar, the voice, and its place in the voice's bar. */
export interface EntryAt {
  readonly measureIndex: number;
  /** The MusicXML voice, which no two staff parts share. */
  readonly voice: number;
  readonly entryIndex: number;
}

/** The name of a bar, by its index into the exercise. */
export function barId(measureIndex: number): string {
  return `m${String(measureIndex)}`;
}

/** The name of one pitch of a note or chord, by its place in the entry's pitches. */
export function noteId(at: EntryAt, pitchIndex: number): string {
  return `n${entryName(at)}-${String(pitchIndex)}`;
}

/**
 * The name of a rest, drawn or not.
 *
 * A silence is written as a rest nobody sees, and it is named like one: the
 * engraver keeps it as a space in the bar that still has a place across it.
 */
export function restId(at: EntryAt): string {
  return `r${entryName(at)}`;
}

/** The name of one pitch of a grace note leaning on the entry at `at`. */
export function graceId(at: EntryAt, graceIndex: number, pitchIndex: number): string {
  return `g${entryName(at)}-${String(graceIndex)}-${String(pitchIndex)}`;
}

function entryName(at: EntryAt): string {
  return `${String(at.measureIndex)}-${String(at.voice)}-${String(at.entryIndex)}`;
}
