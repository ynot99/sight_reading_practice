import { assertNever } from '../../shared/asserts.js';
import { CLEF_DEFINITIONS, type ClefKind } from '../model/Clef.js';
import { DIVISIONS_PER_QUARTER } from '../model/Duration.js';
import type { Duration } from '../model/Duration.js';
import type {
  Exercise,
  MusicalEntry,
  PedalMark,
  StaffPart,
  TempoChange,
} from '../model/Exercise.js';
import type { KeySignature } from '../model/KeySignature.js';
import {
  barNumberOf,
  keyAtMeasure,
  timeAtMeasure,
  tupletPositions,
  validateExercise,
} from '../model/Exercise.js';
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
    // Ties cross bar lines - that is most of what they are for - so what is
    // still being held has to outlive the measure loop.
    //
    // Keyed by *voice*, not by staff. A held note belongs to the line that is
    // holding it, and two voices share a staff whenever an inner line sits
    // under a melody: keyed by staff they overwrite each other, and whichever
    // wrote last decides what the other one is holding. The tie then opens in
    // one bar and never closes, which is a tie the engraver cannot draw.
    const heldByVoice = new Map<number, Set<number>>();
    for (let measureIndex = 0; measureIndex < bars; measureIndex += 1) {
      // The bar's own number, which a passage carries over from the score it
      // was cut out of - so the page itself says that it is bars 20 to 27 and
      // not a piece that happens to be eight bars long.
      writer.element('measure', { number: barNumberOf(exercise, measureIndex) }, () => {
        if (measureIndex === 0) {
          this.writeAttributes(writer, exercise);
          if (this.options.includeMetronomeMark) {
            this.writeTempo(writer, exercise.tempoBpm);
          }
        } else {
          this.writeMidScoreAttributes(writer, exercise, measureIndex);
        }
        // A voice with nothing in this bar is simply not written into it -
        // MusicXML has no need to mention it, and a rest would be drawn.
        const present = exercise.staves.filter(
          (staff) => (staff.measures[measureIndex]?.entries.length ?? 0) > 0,
        );
        // Pedal marks belong to the part, not to a voice, so they are written
        // once - alongside whichever voice happens to be written first.
        const pedal = exercise.pedalMarks.filter(
          (mark) => mark.measureIndex === measureIndex,
        );
        // So do tempo marks, and for a stronger reason: a piece has one tempo
        // however many staves are printed. The one at the very start is
        // written above with the attributes, which is where the opening mark
        // belongs.
        const tempos = exercise.tempoChanges.filter(
          (change) => change.measureIndex === measureIndex,
        );
        // Back to the start of *this* bar, which is not the length of the
        // first one once a metre may change partway through. Written as the
        // opening metre, the second staff of a bar in a wider metre began
        // late and ran past the bar line - and the file we had just written
        // was one we could no longer read.
        const barTicks = timeAtMeasure(exercise, measureIndex).ticksPerMeasure;
        present.forEach((staff, index) => {
          if (index > 0) {
            writer.element('backup', undefined, () => {
              writer.leaf('duration', barTicks);
            });
          }
          this.writeStaffMeasure(
            writer,
            exercise,
            staff,
            measureIndex,
            heldByVoice,
            index === 0 ? pedal : [],
          );
        });
        this.writeTempoChanges(writer, tempos, barTicks, present.length > 0);
      });
    }
  }

  /**
   * Tempo marks, each at the division it takes effect from.
   *
   * Written in a pass of their own rather than beside the notes, because a
   * mark need not fall where any voice has a note: a ritardando is a run of
   * them a sixteenth apart under a held chord, and placed at the nearest note
   * they would collapse onto each other. The cursor is wound back to the bar
   * line and walked forward to each in turn, which is how MusicXML says
   * "here" about something that is not a note.
   */
  private writeTempoChanges(
    writer: XmlWriter,
    tempos: readonly TempoChange[],
    barTicks: number,
    anyStaffWritten: boolean,
  ): void {
    const ordered = [...tempos].sort((left, right) => left.offsetTicks - right.offsetTicks);
    if (ordered.length === 0) {
      return;
    }
    if (anyStaffWritten) {
      writer.element('backup', undefined, () => {
        writer.leaf('duration', barTicks);
      });
    }
    let at = 0;
    for (const change of ordered) {
      const step = Math.min(barTicks, change.offsetTicks) - at;
      if (step > 0) {
        writer.element('forward', undefined, () => {
          writer.leaf('duration', step);
        });
        at += step;
      }
      this.writeTempo(writer, change.tempoBpm);
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
      // Parts sharing a staff number are voices on one staff, so the count and
      // the clefs follow the distinct staves rather than the parts.
      const seen = new Set<number>();
      const staves = exercise.staves.filter((staff) => {
        if (seen.has(staff.staffNumber)) {
          return false;
        }
        seen.add(staff.staffNumber);
        return true;
      });
      writer.leaf('staves', staves.length);
      for (const staff of staves) {
        const definition = CLEF_DEFINITIONS[staff.clef];
        writer.element('clef', { number: staff.staffNumber }, () => {
          writer.leaf('sign', definition.sign);
          writer.leaf('line', definition.line);
        });
      }
    });
  }

  /**
   * Key, metre and clef changes that take effect here.
   *
   * Written as their own `<attributes>` at the head of the measure, which is
   * where a reader expects to meet them: on the bar line, before the notes
   * they govern.
   */
  private writeMidScoreAttributes(
    writer: XmlWriter,
    exercise: Exercise,
    measureIndex: number,
  ): void {
    const key = exercise.keyChanges.find((change) => change.measureIndex === measureIndex);
    const time = exercise.timeChanges.find((change) => change.measureIndex === measureIndex);
    const changing = new Map<number, ClefKind>();
    for (const staff of exercise.staves) {
      for (const change of staff.clefChanges) {
        if (change.measureIndex === measureIndex) {
          changing.set(staff.staffNumber, change.clef);
        }
      }
    }
    if (key === undefined && time === undefined && changing.size === 0) {
      return;
    }
    writer.element('attributes', undefined, () => {
      // Key first, which is the order the schema asks for.
      if (key !== undefined) {
        writer.element('key', undefined, () => {
          writer.leaf('fifths', key.key.fifths);
          writer.leaf('mode', key.key.mode);
        });
      }
      // Then the metre, which the schema wants after the key and before the
      // clefs - and which the engraver needs, or it goes on drawing bar lines
      // where the old metre put them.
      if (time !== undefined) {
        writer.element('time', undefined, () => {
          writer.leaf('beats', time.timeSignature.beats);
          writer.leaf('beat-type', time.timeSignature.beatType);
        });
      }
      for (const [staffNumber, clef] of [...changing].sort((left, right) => left[0] - right[0])) {
        const definition = CLEF_DEFINITIONS[clef];
        writer.element('clef', { number: staffNumber }, () => {
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
    heldByVoice: Map<number, Set<number>>,
    pedal: readonly PedalMark[],
  ): void {
    const measure = staff.measures[measureIndex];
    if (measure === undefined) {
      return;
    }
    // Accidentals are only printed when they change what the reader already
    // knows: the key signature at the bar line, then any accidental so far.
    // Accidentals are read against the key in force here, not the one the
    // piece opened in - otherwise a modulation prints every note of its new
    // key as an accidental.
    const key = keyAtMeasure(exercise, measureIndex);
    const activeAccidentals = new Map<string, Alteration>();
    const tuplets = tupletPositions(measure.entries);
    let held = heldByVoice.get(staff.voice) ?? new Set<number>();
    let offset = 0;
    let nextMark = 0;
    measure.entries.forEach((entry, entryIndex) => {
      while (nextMark < pedal.length && (pedal[nextMark]?.offsetTicks ?? 0) <= offset) {
        this.writePedal(writer, pedal[nextMark], staff.staffNumber);
        nextMark += 1;
      }
      offset += entry.duration.ticks;
      this.writeEntry(
        writer,
        exercise,
        staff,
        entry,
        key,
        activeAccidentals,
        held,
        tuplets[entryIndex] ?? null,
      );
      held = entry.kind === 'note' ? new Set(entry.tiedForward) : new Set<number>();
    });
    while (nextMark < pedal.length) {
      this.writePedal(writer, pedal[nextMark], staff.staffNumber);
      nextMark += 1;
    }
    heldByVoice.set(staff.voice, held);
  }

  private writeEntry(
    writer: XmlWriter,
    exercise: Exercise,
    staff: StaffPart,
    entry: MusicalEntry,
    key: KeySignature,
    activeAccidentals: Map<string, Alteration>,
    held: ReadonlySet<number>,
    tuplet: TupletPosition | null,
  ): void {
    switch (entry.kind) {
      case 'silence': {
        // The format's own word for time passing with nothing drawn in it.
        // No `<type>` and no tuplet marks: `<duration>` is in divisions, which
        // says a third of a beat as exactly as it says half of one.
        writer.element('forward', undefined, () => {
          writer.leaf('duration', entry.duration.ticks);
          writer.leaf('voice', staff.voice);
          writer.leaf('staff', staff.staffNumber);
        });
        return;
      }
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
              : this.accidentalFor(key, pitch, activeAccidentals);
            if (accidental !== undefined) {
              writer.leaf('accidental', accidental);
            }
            this.writeTimeModification(writer, entry.duration);
            if (entry.stem !== null) {
              writer.leaf('stem', entry.stem);
            }
            writer.leaf('staff', staff.staffNumber);
            // Beaming belongs to the first note of a chord; the others share
            // its stem and would otherwise repeat the same beam.
            if (pitchIndex === 0) {
              for (const beam of entry.beams) {
                writer.leaf('beam', beam.type, { number: beam.level });
              }
            }
            // One `<notations>` per note: the tie's slur and the tuplet's
            // bracket are separate marks that share the element.
            const marked = pitchIndex === 0 && (entry.fermata || entry.breath);
            if (stopping || starting || tuplet !== null || entry.arpeggiated || marked) {
              writer.element('notations', undefined, () => {
                if (stopping) {
                  writer.leaf('tied', undefined, { type: 'stop' });
                }
                if (starting) {
                  writer.leaf('tied', undefined, { type: 'start' });
                }
                this.writeTupletMarks(writer, tuplet);
                if (entry.arpeggiated) {
                  writer.leaf('arpeggiate');
                }
                // On the first note of a chord only: a fermata belongs to the
                // chord and a comma to the line, and writing either once per
                // pitch stacks three of them on top of each other.
                if (marked && entry.fermata) {
                  writer.leaf('fermata');
                }
                if (marked && entry.breath) {
                  writer.element('articulations', undefined, () => {
                    writer.leaf('breath-mark');
                  });
                }
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

  private writePedal(
    writer: XmlWriter,
    mark: PedalMark | undefined,
    staffNumber: number,
  ): void {
    if (mark === undefined) {
      return;
    }
    writer.element('direction', { placement: 'below' }, () => {
      writer.element('direction-type', undefined, () => {
        writer.leaf('pedal', undefined, { type: mark.type, line: 'no', sign: 'yes' });
      });
      writer.leaf('staff', staffNumber);
    });
  }

  private accidentalFor(
    key: KeySignature,
    pitch: Pitch,
    activeAccidentals: Map<string, Alteration>,
  ): string | undefined {
    const seen = accidentalKey(pitch);
    const expected = activeAccidentals.get(seen) ?? key.alterationFor(pitch.step);
    if (pitch.alter === expected) {
      return undefined;
    }
    activeAccidentals.set(seen, pitch.alter);
    return ACCIDENTAL_NAMES.get(pitch.alter);
  }
}
