import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import {
  noteEntry,
  restEntry,
  type Beam,
  type BeamType,
  type MusicalEntry,
} from '../../src/domain/model/Exercise.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { closedBeams, MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { twoBarExercise, bar } from '../support/fixtures.js';

/** An eighth, beamed as said: one type per level, from the eighth beam down. */
function beamed(...types: BeamType[]): MusicalEntry {
  const beams: Beam[] = types.map((type, index) => ({ level: index + 1, type }));
  return noteEntry(Pitch.parse('C5'), Duration.EIGHTH, [], beams);
}

const plain = (): MusicalEntry => noteEntry(Pitch.parse('C5'), Duration.EIGHTH);
const rest = (): MusicalEntry => restEntry(Duration.EIGHTH);

/** Each entry's beams, as the types of its levels in order. */
function said(entries: readonly MusicalEntry[]): string[][] {
  return closedBeams(entries).map((beams) =>
    [...beams].sort((left, right) => left.level - right.level).map((beam) => beam.type),
  );
}

describe('closing every beam group on its own last note', () => {
  it('leaves groups that were written whole exactly as they were', () => {
    // Four sixteenths, then a dotted eighth and its sixteenth, whose short
    // beam is a hook of its own rather than part of a group.
    const entries = [
      beamed('begin', 'begin'),
      beamed('continue', 'continue'),
      beamed('continue', 'continue'),
      beamed('end', 'end'),
      beamed('begin'),
      beamed('end', 'backward hook'),
    ];

    expect(said(entries)).toEqual([
      ['begin', 'begin'],
      ['continue', 'continue'],
      ['continue', 'continue'],
      ['end', 'end'],
      ['begin'],
      ['end', 'backward hook'],
    ]);
  });

  it('ends a group the writer ended on a rest at the last note before it', () => {
    // His Alkan, bar 1274: begin, rest, continue, rest - and then the next
    // group begins with the first one never closed. A rest carries no beam
    // here, so the end the writer put on it was lost on the way in.
    const entries = [beamed('begin'), rest(), beamed('continue'), rest(), beamed('begin'), beamed('end')];

    expect(said(entries)).toEqual([['begin'], [], ['end'], [], ['begin'], ['end']]);
  });

  it('closes a group left open at the end of the bar', () => {
    // Bar 1269's bass: a beam begun and never ended ran on into the next
    // system under an engraver that took it at its word.
    expect(said([beamed('begin'), beamed('continue')])).toEqual([['begin'], ['end']]);
  });

  it('takes the beam off a group of one note', () => {
    expect(said([beamed('begin'), plain()])).toEqual([[], []]);
    expect(said([plain(), beamed('end')])).toEqual([[], []]);
  });

  it('begins a group that was only ever continued', () => {
    expect(said([plain(), beamed('continue'), beamed('end')])).toEqual([[], ['begin'], ['end']]);
  });

  it('ends a group at a note the beam does not reach', () => {
    // And the one after it begins again, though it was written as going on.
    expect(said([beamed('begin'), beamed('continue'), plain(), beamed('continue'), beamed('end')])).toEqual([
      ['begin'],
      ['end'],
      [],
      ['begin'],
      ['end'],
    ]);
  });

  it('keeps a shorter beam inside the eighth beam it hangs from', () => {
    // The sixteenth beam was continued across the place a new eighth group
    // begins, which no engraver can draw.
    const entries = [beamed('begin', 'begin'), beamed('end', 'continue'), beamed('begin', 'continue'), beamed('end', 'end')];

    expect(said(entries)).toEqual([
      ['begin', 'begin'],
      ['end', 'end'],
      ['begin', 'begin'],
      ['end', 'end'],
    ]);
  });

  it('drops the shorter beams of notes that lost their eighth beam', () => {
    // Two lone ends: no eighth group at all, and a sixteenth group between
    // them that would otherwise be drawn hanging from nothing.
    expect(said([beamed('end', 'begin'), beamed('end', 'end')])).toEqual([[], []]);
  });
});

describe('writing the beams of a bar', () => {
  it('writes each group closed, as closedBeams has it', () => {
    const exercise = twoBarExercise();
    const first = exercise.staves[0];
    if (first === undefined) {
      throw new Error('the fixture has a staff');
    }
    const xml = new MusicXmlSerializer().serialize({
      ...exercise,
      staves: [
        {
          ...first,
          measures: [
            bar(beamed('begin'), rest(), beamed('continue'), rest(), plain(), plain(), plain(), plain()),
            ...first.measures.slice(1),
          ],
        },
        ...exercise.staves.slice(1),
      ],
    });

    const written = [...xml.matchAll(/<beam number="1">([a-z ]+)<\/beam>/g)].map((found) => found[1]);
    expect(written.slice(0, 2)).toEqual(['begin', 'end']);
  });
});

describe('the sign for a double sharp', () => {
  it('is the one sign, not two sharps side by side', () => {
    // `sharp-sharp` is the format's word for two sharps, and an engraver that
    // reads the format as written prints exactly that.
    const exercise = twoBarExercise();
    const first = exercise.staves[0];
    if (first === undefined) {
      throw new Error('the fixture has a staff');
    }
    const xml = new MusicXmlSerializer().serialize({
      ...exercise,
      staves: [
        {
          ...first,
          measures: [
            bar(
              noteEntry(new Pitch('F', 4, 2), Duration.HALF),
              noteEntry(new Pitch('C', 5, 0), Duration.HALF),
            ),
            ...first.measures.slice(1),
          ],
        },
        ...exercise.staves.slice(1),
      ],
    });

    expect(xml).toContain('<accidental>double-sharp</accidental>');
    expect(xml).not.toContain('sharp-sharp');
  });
});
