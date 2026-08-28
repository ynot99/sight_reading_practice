import { assertNever } from '../../shared/asserts.js';
import { CLEF_DEFINITIONS } from '../model/Clef.js';
import { DIVISIONS_PER_QUARTER } from '../model/Duration.js';
import type { Duration } from '../model/Duration.js';
import type { Exercise, MusicalEntry, StaffPart } from '../model/Exercise.js';
import { tupletPositions, validateExercise } from '../model/Exercise.js';
import type { TupletPosition } from '../model/Exercise.js';
import type { Alteration, Pitch } from '../model/Pitch.js';
import { XmlWriter } from './XmlWriter.js';

/**
 * Turns an {@link Exercise} into engraver-ready notation.
 *
 * The renderer is an implementation detail behind this port: OSMD consumes
 * MusicXML today, and any other engraver that speaks it can be swapped in.
 */
export interface IMusicXmlSerializer {
  serialize(exercise: Exercise): string;
}

export interface MusicXmlSerializerOptions {
  /** Value written to `<software>`. */
  readonly software?: string;
  /** Optional fixed `<encoding-date>`; omitted by default so output is stable. */
  readonly encodingDate?: string;
  /** Draw the tempo mark above the first measure. */
  readonly includeMetronomeMark?: boolean;
  readonly partName?: string;
}

const ACCIDENTAL_NAMES: ReadonlyMap<number, string> = new Map([
  [-2, 'flat-flat'],
  [-1, 'flat'],
  [0, 'natural'],
  [1, 'sharp'],
  [2, 'sharp-sharp'],
]);

/** Key for the "accidentals last until the end of the measure" rule. */
function accidentalKey(pitch: Pitch): string {
  return `${pitch.step}${pitch.octave}`;
}

interface ResolvedOptions {
  readonly software: string;
  readonly includeMetronomeMark: boolean;
  readonly partName: string;
  readonly encodingDate: string | undefined;
}

/**
 * MusicXML 4.0 partwise serializer for grand-staff exercises.
 *
 * Everything is derived from the exercise, including the accidental-carry
 * rules, so the printed page always agrees with the timeline the matcher uses.
 */
export class MusicXmlSerializer implements IMusicXmlSerializer {
  private readonly options: ResolvedOptions;

  constructor(options: MusicXmlSerializerOptions = {}) {
    this.options = {
      software: options.software ?? 'sight-reading-practice',
      includeMetronomeMark: options.includeMetronomeMark ?? true,
      partName: options.partName ?? 'Piano',
      encodingDate: options.encodingDate,
    };
  }

  serialize(exercise: Exercise): string {
    validateExercise(exercise);

    const writer = new XmlWriter();
    writer.raw('<?xml version="1.0" encoding="UTF-8"?>');
    writer.raw(
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    );

    writer.element('score-partwise', { version: '4.0' }, () => {
      writer.element('work', undefined, () => {
        writer.leaf('work-title', exercise.title);
      });
      writer.element('identification', undefined, () => {
        writer.element('encoding', undefined, () => {
          writer.leaf('software', this.options.software);
          if (this.options.encodingDate !== undefined) {
            writer.leaf('encoding-date', this.options.encodingDate);
          }
        });
      });
      writer.element('part-list', undefined, () => {
        writer.element('score-part', { id: 'P1' }, () => {
          writer.leaf('part-name', this.options.partName);
        });
      });
      writer.element('part', { id: 'P1' }, () => {
        this.writeMeasures(writer, exercise);
      });
    });

    return writer.toString();
  }

  private writeMeasures(writer: XmlWriter, exercise: Exercise): void {
    const bars = exercise.staves[0]?.measures.length ?? 0;
    // Ties cross bar lines - that is most of what they are for - so what each
    // staff is still holding has to outlive the measure loop.
    const heldByStaff = new Map<number, Set<number>>();
    for (let measureIndex = 0; measureIndex < bars; measureIndex += 1) {
      writer.element('measure', { number: measureIndex + 1 }, () => {
        if (measureIndex === 0) {
          this.writeAttributes(writer, exercise);
          if (this.options.includeMetronomeMark) {
            this.writeTempo(writer, exercise.tempoBpm);
          }
        }
        exercise.staves.forEach((staff, staffIndex) => {
          if (staffIndex > 0) {
            writer.element('backup', undefined, () => {
              writer.leaf('duration', exercise.timeSignature.ticksPerMeasure);
            });
          }
          this.writeStaffMeasure(writer, exercise, staff, measureIndex, heldByStaff);
        });
      });
    }
  }

  private writeAttributes(writer: XmlWriter, exercise: Exercise): void {
    writer.element('attributes', undefined, () => {
      writer.leaf('divisions', DIVISIONS_PER_QUARTER);
      writer.element('key', undefined, () => {
        writer.leaf('fifths', exercise.key.fifths);
        writer.leaf('mode', exercise.key.mode);
      });
      writer.element('time', undefined, () => {
        writer.leaf('beats', exercise.timeSignature.beats);
        writer.leaf('beat-type', exercise.timeSignature.beatType);
      });
      writer.leaf('staves', exercise.staves.length);
      for (const staff of exercise.staves) {
        const definition = CLEF_DEFINITIONS[staff.clef];
        writer.element('clef', { number: staff.staffNumber }, () => {
          writer.leaf('sign', definition.sign);
          writer.leaf('line', definition.line);
        });
      }
    });
  }

  private writeTempo(writer: XmlWriter, tempoBpm: number): void {
    writer.element('direction', { placement: 'above' }, () => {
      writer.element('direction-type', undefined, () => {
        writer.element('metronome', { parentheses: 'no' }, () => {
          writer.leaf('beat-unit', 'quarter');
          writer.leaf('per-minute', tempoBpm);
        });
      });
      writer.leaf('sound', undefined, { tempo: tempoBpm });
    });
  }

  private writeStaffMeasure(
    writer: XmlWriter,
    exercise: Exercise,
    staff: StaffPart,
    measureIndex: number,
    heldByStaff: Map<number, Set<number>>,
  ): void {
    const measure = staff.measures[measureIndex];
    if (measure === undefined) {
      return;
    }
    // Accidentals are only printed when they change what the reader already
    // knows: the key signature at the bar line, then any accidental so far.
    const activeAccidentals = new Map<string, Alteration>();
    const tuplets = tupletPositions(measure.entries);
    let held = heldByStaff.get(staff.staffNumber) ?? new Set<number>();
    measure.entries.forEach((entry, entryIndex) => {
      this.writeEntry(
        writer,
        exercise,
        staff,
        entry,
        activeAccidentals,
        held,
        tuplets[entryIndex] ?? null,
      );
      held = entry.kind === 'note' ? new Set(entry.tiedForward) : new Set<number>();
    });
    heldByStaff.set(staff.staffNumber, held);
  }

  private writeEntry(
    writer: XmlWriter,
    exercise: Exercise,
    staff: StaffPart,
    entry: MusicalEntry,
    activeAccidentals: Map<string, Alteration>,
    held: ReadonlySet<number>,
    tuplet: TupletPosition | null,
  ): void {
    switch (entry.kind) {
      case 'rest': {
        const isFullMeasure = entry.duration.ticks === exercise.timeSignature.ticksPerMeasure;
        writer.element('note', undefined, () => {
          writer.leaf('rest', undefined, isFullMeasure ? { measure: 'yes' } : undefined);
          writer.leaf('duration', entry.duration.ticks);
          writer.leaf('voice', staff.voice);
          if (!isFullMeasure) {
            writer.leaf('type', entry.duration.type);
            if (entry.duration.dots === 1) {
              writer.leaf('dot');
            }
          }
          this.writeTimeModification(writer, entry.duration);
          writer.leaf('staff', staff.staffNumber);
          this.writeTupletNotations(writer, tuplet);
        });
        return;
      }
      case 'note': {
        entry.pitches.forEach((pitch, pitchIndex) => {
          const stopping = held.has(pitch.midi);
          const starting = entry.tiedForward.includes(pitch.midi);
          writer.element('note', undefined, () => {
            if (pitchIndex > 0) {
              writer.leaf('chord');
            }
            writer.element('pitch', undefined, () => {
              writer.leaf('step', pitch.step);
              if (pitch.alter !== 0) {
                writer.leaf('alter', pitch.alter);
              }
              writer.leaf('octave', pitch.octave);
            });
            writer.leaf('duration', entry.duration.ticks);
            // `<tie>` is the sound - one press held - and `<tied>` below is the
            // slur the reader sees. MusicXML keeps them apart, and a note that
            // ends one tie and begins another writes the stop first.
            if (stopping) {
              writer.leaf('tie', undefined, { type: 'stop' });
            }
            if (starting) {
              writer.leaf('tie', undefined, { type: 'start' });
            }
            writer.leaf('voice', staff.voice);
            writer.leaf('type', entry.duration.type);
            if (entry.duration.dots === 1) {
              writer.leaf('dot');
            }
            // A continuation never reprints the accidental: the reader was
            // told at the start of the tie and the note never stopped.
            const accidental = stopping
              ? undefined
              : this.accidentalFor(exercise, pitch, activeAccidentals);
            if (accidental !== undefined) {
              writer.leaf('accidental', accidental);
            }
            this.writeTimeModification(writer, entry.duration);
            writer.leaf('staff', staff.staffNumber);
            // One `<notations>` per note: the tie's slur and the tuplet's
            // bracket are separate marks that share the element.
            if (stopping || starting || tuplet !== null) {
              writer.element('notations', undefined, () => {
                if (stopping) {
                  writer.leaf('tied', undefined, { type: 'stop' });
                }
                if (starting) {
                  writer.leaf('tied', undefined, { type: 'start' });
                }
                this.writeTupletMarks(writer, tuplet);
              });
            }
          });
        });
        return;
      }
      default:
        assertNever(entry, 'Unknown musical entry');
    }
  }

  /** The ratio itself: three notes played in the time of two. */
  private writeTimeModification(writer: XmlWriter, duration: Duration): void {
    if (!duration.isTuplet) {
      return;
    }
    writer.element('time-modification', undefined, () => {
      writer.leaf('actual-notes', duration.tuplet.actual);
      writer.leaf('normal-notes', duration.tuplet.normal);
    });
  }

  /** The bracket, which only the ends of a group carry. Used by rests. */
  private writeTupletNotations(writer: XmlWriter, tuplet: TupletPosition | null): void {
    if (tuplet === null || (!tuplet.starts && !tuplet.stops)) {
      return;
    }
    writer.element('notations', undefined, () => {
      this.writeTupletMarks(writer, tuplet);
    });
  }

  private writeTupletMarks(writer: XmlWriter, tuplet: TupletPosition | null): void {
    if (tuplet === null) {
      return;
    }
    if (tuplet.starts) {
      writer.leaf('tuplet', undefined, { type: 'start', number: 1 });
    }
    if (tuplet.stops) {
      writer.leaf('tuplet', undefined, { type: 'stop', number: 1 });
    }
  }

  private accidentalFor(
    exercise: Exercise,
    pitch: Pitch,
    activeAccidentals: Map<string, Alteration>,
  ): string | undefined {
    const key = accidentalKey(pitch);
    const expected = activeAccidentals.get(key) ?? exercise.key.alterationFor(pitch.step);
    if (pitch.alter === expected) {
      return undefined;
    }
    activeAccidentals.set(key, pitch.alter);
    return ACCIDENTAL_NAMES.get(pitch.alter);
  }
}
