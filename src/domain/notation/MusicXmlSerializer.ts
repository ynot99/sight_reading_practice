import { assertNever } from '../../shared/asserts.js';
import { CLEF_DEFINITIONS } from '../model/Clef.js';
import { DIVISIONS_PER_QUARTER } from '../model/Duration.js';
import type { Exercise, MusicalEntry, StaffPart } from '../model/Exercise.js';
import { validateExercise } from '../model/Exercise.js';
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
          this.writeStaffMeasure(writer, exercise, staff, measureIndex);
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
  ): void {
    const measure = staff.measures[measureIndex];
    if (measure === undefined) {
      return;
    }
    // Accidentals are only printed when they change what the reader already
    // knows: the key signature at the bar line, then any accidental so far.
    const activeAccidentals = new Map<string, Alteration>();
    for (const entry of measure.entries) {
      this.writeEntry(writer, exercise, staff, entry, activeAccidentals);
    }
  }

  private writeEntry(
    writer: XmlWriter,
    exercise: Exercise,
    staff: StaffPart,
    entry: MusicalEntry,
    activeAccidentals: Map<string, Alteration>,
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
          writer.leaf('staff', staff.staffNumber);
        });
        return;
      }
      case 'note': {
        entry.pitches.forEach((pitch, pitchIndex) => {
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
            writer.leaf('voice', staff.voice);
            writer.leaf('type', entry.duration.type);
            if (entry.duration.dots === 1) {
              writer.leaf('dot');
            }
            const accidental = this.accidentalFor(exercise, pitch, activeAccidentals);
            if (accidental !== undefined) {
              writer.leaf('accidental', accidental);
            }
            writer.leaf('staff', staff.staffNumber);
          });
        });
        return;
      }
      default:
        assertNever(entry, 'Unknown musical entry');
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
