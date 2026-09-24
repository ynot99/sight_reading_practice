import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { noteEntry } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { XmlWriter, escapeXmlText } from '../../src/domain/notation/XmlWriter.js';
import { DomainError, ExerciseValidationError } from '../../src/shared/errors.js';
import { bar, p, partialVoiceExercise, twoBarExercise } from '../support/fixtures.js';

interface ElementLike {
  getAttribute(name: string): string | null;
  getElementsByTagName(tag: string): { length: number; item(index: number): ElementLike | null };
  textContent: string | null;
  tagName: string;
}

function parse(xml: string): ElementLike {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const root = document.documentElement;
  if (root === null) {
    throw new Error('Serializer produced a document without a root element.');
  }
  return root as unknown as ElementLike;
}

function all(scope: ElementLike, tag: string): ElementLike[] {
  const collection = scope.getElementsByTagName(tag);
  const items: ElementLike[] = [];
  for (let index = 0; index < collection.length; index += 1) {
    const item = collection.item(index);
    if (item !== null) {
      items.push(item);
    }
  }
  return items;
}

function first(scope: ElementLike, tag: string): ElementLike {
  const [item] = all(scope, tag);
  if (item === undefined) {
    throw new Error(`No <${tag}> found.`);
  }
  return item;
}

function text(scope: ElementLike, tag: string): string {
  return first(scope, tag).textContent ?? '';
}

const serializer = new MusicXmlSerializer();

describe('MusicXmlSerializer', () => {
  const xml = serializer.serialize(twoBarExercise());
  const root = parse(xml);

  it('produces a partwise MusicXML 4.0 document', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('DTD MusicXML 4.0 Partwise');
    expect(root.tagName).toBe('score-partwise');
    expect(root.getAttribute('version')).toBe('4.0');
  });

  it('declares divisions, key, time and both clefs once, in the first measure', () => {
    const attributes = all(root, 'attributes');
    expect(attributes).toHaveLength(1);
    const [block] = attributes;
    if (block === undefined) {
      throw new Error('expected an attributes block');
    }

    expect(text(block, 'divisions')).toBe(String(Duration.QUARTER.ticks));
    expect(text(block, 'fifths')).toBe('0');
    expect(text(block, 'mode')).toBe('major');
    expect(text(block, 'beats')).toBe('4');
    expect(text(block, 'beat-type')).toBe('4');
    expect(text(block, 'staves')).toBe('2');

    const clefs = all(block, 'clef');
    expect(clefs).toHaveLength(2);
    expect(clefs[0]?.getAttribute('number')).toBe('1');
    expect(text(clefs[0] as ElementLike, 'sign')).toBe('G');
    expect(text(clefs[1] as ElementLike, 'sign')).toBe('F');
  });

  it('writes one measure per bar and a backup between the staves', () => {
    const measures = all(root, 'measure');
    expect(measures).toHaveLength(2);
    expect(measures[0]?.getAttribute('number')).toBe('1');

    const backups = all(root, 'backup');
    expect(backups).toHaveLength(2);
    expect(text(backups[0] as ElementLike, 'duration')).toBe(String(Duration.WHOLE.ticks));
  });

  it('prints the bar numbers the passage carries, not a fresh count from one', () => {
    // The strongest indication there is that a passage is a passage: it is on
    // the page, over the first bar, without anything having to say it in
    // words. Renumbered from 1 the page insists it is a whole short piece.
    const passage = serializer.serialize({ ...twoBarExercise(), firstBarNumber: 20 });

    expect(all(parse(passage), 'measure').map((measure) => measure.getAttribute('number'))).toEqual(
      ['20', '21'],
    );
  });

  it('assigns every note to its staff and voice', () => {
    const [firstMeasure] = all(root, 'measure');
    if (firstMeasure === undefined) {
      throw new Error('expected a first measure');
    }
    const notes = all(firstMeasure, 'note');
    // Four treble quarters plus one bass whole note.
    expect(notes).toHaveLength(5);

    const trebleNote = notes[0] as ElementLike;
    expect(text(trebleNote, 'step')).toBe('C');
    expect(text(trebleNote, 'octave')).toBe('4');
    expect(text(trebleNote, 'duration')).toBe(String(Duration.QUARTER.ticks));
    expect(text(trebleNote, 'type')).toBe('quarter');
    expect(text(trebleNote, 'voice')).toBe('1');
    expect(text(trebleNote, 'staff')).toBe('1');

    const bassNote = notes[4] as ElementLike;
    expect(text(bassNote, 'octave')).toBe('3');
    expect(text(bassNote, 'type')).toBe('whole');
    expect(text(bassNote, 'staff')).toBe('2');
  });

  it('marks the second and later pitches of a chord with <chord/>', () => {
    const measures = all(root, 'measure');
    const secondMeasure = measures[1];
    if (secondMeasure === undefined) {
      throw new Error('expected a second measure');
    }
    const chordMarkers = all(secondMeasure, 'chord');
    expect(chordMarkers).toHaveLength(1);
    expect(all(secondMeasure, 'note')).toHaveLength(4);
  });

  it('writes whole-bar rests as measure rests without a type', () => {
    const xmlWithRest = serializer.serialize({
      ...twoBarExercise(),
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble',
          clefChanges: [],
          measures: [
            bar({ kind: 'rest', duration: Duration.WHOLE }),
            bar(noteEntry(p('G4'), Duration.WHOLE)),
          ],
        },
      ],
    });
    expect(xmlWithRest).toContain('<rest measure="yes"/>');
    const restNote = first(parse(xmlWithRest), 'note');
    expect(all(restNote, 'type')).toHaveLength(0);
  });

  it('writes shorter rests with their notated type', () => {
    const secondMeasure = all(root, 'measure')[1];
    if (secondMeasure === undefined) {
      throw new Error('expected a second measure');
    }
    const rests = all(secondMeasure, 'rest');
    expect(rests).toHaveLength(1);
    expect(rests[0]?.getAttribute('measure')).toBeNull();
    expect(xml).toContain('<type>half</type>');
  });

  it('draws the tempo mark once', () => {
    expect(all(root, 'metronome')).toHaveLength(1);
    expect(text(root, 'per-minute')).toBe('60');
    expect(first(root, 'sound').getAttribute('tempo')).toBe('60');
  });

  it('is deterministic', () => {
    expect(serializer.serialize(twoBarExercise())).toBe(xml);
  });

  it('validates before serialising', () => {
    const broken: Exercise = { ...twoBarExercise(), tempoBpm: -1 };
    expect(() => serializer.serialize(broken)).toThrow(ExerciseValidationError);
  });

  describe('accidentals', () => {
    const dMajor = KeySignature.major(2);
    const exercise: Exercise = {
      id: 'accidentals',
      title: 'Accidentals',
      key: dMajor,
      keyChanges: [],
      timeChanges: [],
      tempoChanges: [],
      pedalMarks: [],
      dynamicMarks: [],
      tempoWords: [],
      hairpins: [],
      octaveShifts: [],
      timeSignature: new TimeSignature(4, 4),
      tempoBpm: 72,
      firstBarNumber: 1,
      barLabels: [],
      metadata: { generatorId: 'fixture', seed: 3 },
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble',
          clefChanges: [],
          measures: [
            bar(
              noteEntry(new Pitch('F', 4, 1), Duration.QUARTER),
              noteEntry(new Pitch('C', 4, 0), Duration.QUARTER),
              noteEntry(new Pitch('C', 4, 0), Duration.QUARTER),
              noteEntry(new Pitch('F', 4, 1), Duration.QUARTER),
            ),
          ],
        },
      ],
    };

    it('omits accidentals implied by the key signature', () => {
      const document = parse(serializer.serialize(exercise));
      const notes = all(document, 'note');
      expect(all(notes[0] as ElementLike, 'accidental')).toHaveLength(0);
      expect(text(notes[0] as ElementLike, 'alter')).toBe('1');
    });

    it('prints an accidental only the first time it contradicts the key', () => {
      const document = parse(serializer.serialize(exercise));
      const notes = all(document, 'note');
      expect(text(notes[1] as ElementLike, 'accidental')).toBe('natural');
      // The natural carries to the end of the bar, so it is not repeated.
      expect(all(notes[2] as ElementLike, 'accidental')).toHaveLength(0);
    });
  });
});

describe('the names printed on every bar and note', () => {
  // The engraver keeps the `id` each `<measure>` and `<note>` is written with,
  // so the page can be read by name: the notes a step asks for, the bar a
  // passage ends in. Named by where each stands in the exercise, which the
  // timeline knows as well as the page does.
  const ids = (scope: ElementLike, tag: string): string[] =>
    all(scope, tag).map((element) => element.getAttribute('id') ?? '');

  it('names every bar by its index', () => {
    const root = parse(serializer.serialize(twoBarExercise()));

    expect(ids(root, 'measure')).toEqual(['m0', 'm1']);
  });

  it('names every pitch by its bar, its voice, its entry and its place in the chord', () => {
    //   voice 1: C4 D4 E4 F4 | G4
    //   voice 2: C3          | [G2 D3] + rest
    const root = parse(serializer.serialize(twoBarExercise()));
    const pitched = all(root, 'note').filter((note) => all(note, 'pitch').length > 0);

    expect(
      pitched.map((note) => `${note.getAttribute('id') ?? ''} ${text(note, 'step')}${text(note, 'octave')}`),
    ).toEqual([
      'n0-1-0-0 C4',
      'n0-1-1-0 D4',
      'n0-1-2-0 E4',
      'n0-1-3-0 F4',
      'n0-2-0-0 C3',
      'n1-1-0-0 G4',
      'n1-2-0-0 G2',
      'n1-2-0-1 D3',
    ]);
  });

  it('names a rest by the entry it is', () => {
    const root = parse(serializer.serialize(twoBarExercise()));
    const rests = all(root, 'note').filter((note) => all(note, 'rest').length > 0);

    expect(rests.map((rest) => rest.getAttribute('id'))).toEqual(['r1-2-1']);
  });

  it('names a rest nobody draws the same way', () => {
    // A silence is a space in the bar the engraver still places, and a voice
    // entering late is found by it.
    const root = parse(serializer.serialize(partialVoiceExercise()));
    const unseen = all(root, 'note').filter((note) => note.getAttribute('print-object') === 'no');

    expect(unseen.map((rest) => rest.getAttribute('id'))).toEqual(['r0-2-0', 'r0-2-2']);
  });

  it('names a grace note by the entry it leans on, and its place among the graces', () => {
    const leaning = noteEntry(p('C5'), Duration.HALF, [], [], null, false, {
      graces: [
        { pitches: [p('D5'), p('F5')], duration: Duration.EIGHTH, slashed: true },
        { pitches: [p('E5')], duration: Duration.EIGHTH, slashed: false },
      ],
    });
    const exercise = partialVoiceExercise([
      noteEntry(p('G3'), Duration.HALF),
      leaning,
    ]);
    const root = parse(serializer.serialize(exercise));
    const graces = all(root, 'note').filter((note) => all(note, 'grace').length > 0);

    expect(graces.map((grace) => `${grace.getAttribute('id') ?? ''} ${text(grace, 'step')}`)).toEqual([
      'g0-2-1-0-0 D',
      'g0-2-1-0-1 F',
      'g0-2-1-1-0 E',
    ]);
    // And the note they lean on keeps its own.
    expect(ids(root, 'note')).toContain('n0-2-1-0');
  });

  it('never gives two things one name', () => {
    for (const exercise of [twoBarExercise(), partialVoiceExercise()]) {
      const named = [
        ...ids(parse(serializer.serialize(exercise)), 'measure'),
        ...ids(parse(serializer.serialize(exercise)), 'note'),
      ];

      expect(named.every((id) => id !== '')).toBe(true);
      expect(new Set(named).size).toBe(named.length);
    }
  });
});

describe('XmlWriter', () => {
  it('indents nested elements', () => {
    const writer = new XmlWriter();
    writer.element('outer', { id: '1' }, () => {
      writer.leaf('inner', 'value');
      writer.leaf('empty');
    });

    expect(writer.toString()).toBe('<outer id="1">\n  <inner>value</inner>\n  <empty/>\n</outer>\n');
  });

  it('escapes text and attributes', () => {
    const writer = new XmlWriter();
    writer.leaf('title', 'Fun & <Games>', { note: 'say "hi"' });
    expect(writer.toString()).toBe(
      '<title note="say &quot;hi&quot;">Fun &amp; &lt;Games&gt;</title>\n',
    );
    expect(escapeXmlText('a<b>c&d')).toBe('a&lt;b&gt;c&amp;d');
  });

  it('refuses to emit unbalanced documents', () => {
    const writer = new XmlWriter();
    writer.open('outer');
    expect(() => writer.toString()).toThrow(DomainError);
    expect(() => new XmlWriter().close()).toThrow(DomainError);
  });

  it('skips undefined attributes', () => {
    const writer = new XmlWriter();
    writer.leaf('rest', undefined, { measure: undefined });
    expect(writer.toString()).toBe('<rest/>\n');
  });
});

describe('a tie in one voice of a shared staff', () => {
  /**
   * Two voices on one staff, the lower one holding a chord across the bar.
   *
   *   voice 1 (staff 2): C3 half, C3 half        - moving, ties nothing
   *   voice 2 (staff 2): [G3 B3] half, tied over - held across the bar line
   */
  function twoVoicesOnOneStaff(): Exercise {
    return {
      id: 'tie-across-voices',
      title: 'Tie across voices',
      key: KeySignature.major(0),
      keyChanges: [],
      timeChanges: [],
      tempoChanges: [],
      pedalMarks: [],
      dynamicMarks: [],
      tempoWords: [],
      hairpins: [],
      octaveShifts: [],
      timeSignature: new TimeSignature(2, 4),
      tempoBpm: 60,
      firstBarNumber: 1,
      barLabels: [],
      metadata: { generatorId: 'fixture', seed: 1 },
      staves: [
        {
          staffNumber: 2,
          voice: 1,
          clef: 'bass',
          clefChanges: [],
          measures: [
            bar(noteEntry(p('C3'), Duration.HALF)),
            bar(noteEntry(p('C3'), Duration.HALF)),
          ],
        },
        {
          staffNumber: 2,
          voice: 2,
          clef: 'bass',
          clefChanges: [],
          measures: [
            bar(noteEntry([p('G3'), p('B3')], Duration.HALF, [p('G3').midi, p('B3').midi])),
            bar(noteEntry([p('G3'), p('B3')], Duration.HALF)),
          ],
        },
      ],
    };
  }

  function tiesOf(xml: string, type: 'start' | 'stop'): ElementLike[] {
    return all(parse(xml), 'tie').filter((tie) => tie.getAttribute('type') === type);
  }

  it('is closed in the next bar, not left hanging', () => {
    const xml = serializer.serialize(twoVoicesOnOneStaff());

    // A held note belongs to the *voice* holding it. Tracked per staff, the
    // moving voice wipes what the held one is carrying, and the tie opens in
    // one bar and never closes - which OSMD cannot draw, so the reader sees
    // a fresh chord and presses notes the music never asked for again.
    expect(tiesOf(xml, 'start')).toHaveLength(2);
    expect(tiesOf(xml, 'stop')).toHaveLength(2);
  });

  it('draws the slur at both ends too', () => {
    const xml = serializer.serialize(twoVoicesOnOneStaff());
    const tied = all(parse(xml), 'tied');

    // `<tie>` is the sound and `<tied>` is the arc; a missing stop on either
    // leaves the reader without the mark that says "do not play this again".
    expect(tied.filter((mark) => mark.getAttribute('type') === 'start')).toHaveLength(2);
    expect(tied.filter((mark) => mark.getAttribute('type') === 'stop')).toHaveLength(2);
  });

  it('leaves the voice that ties nothing alone', () => {
    const xml = serializer.serialize(twoVoicesOnOneStaff());
    const notes = all(parse(xml), 'note').filter(
      (note) => text(note, 'voice') === '1',
    );

    for (const note of notes) {
      expect(all(note, 'tie')).toHaveLength(0);
    }
  });
});

describe('a voice that is absent for part of a bar', () => {
  const serializer = new MusicXmlSerializer();

  it('says so with a rest nobody draws', () => {
    // It was `<forward>`, which is the format's own word for time passing
    // with nothing in it - and which the engraver this program actually uses
    // lays out wrongly: measured on Clair de Lune bar 47, a voice entering
    // at the end of the bar had its notes drawn at the *beginning* of it. An
    // invisible rest says the same thing and is laid out where it belongs.
    const xml = serializer.serialize(partialVoiceExercise());
    const rests = all(parse(xml), 'note').filter((node) => all(node, 'rest').length > 0);

    expect(all(parse(xml), 'forward')).toHaveLength(0);
    expect(rests).toHaveLength(2);
    // Not drawn: the writer wrote no rest here, and this is only time.
    expect(rests.map((node) => node.getAttribute('print-object'))).toEqual(['no', 'no']);
    expect(rests.map((node) => text(node, 'duration'))).toEqual([
      String(Duration.QUARTER.ticks),
      String(Duration.QUARTER.ticks),
    ]);
    // Named, so a part of several staves knows which line the time belongs to.
    expect(rests.map((node) => text(node, 'voice'))).toEqual(['2', '2']);
    expect(rests.map((node) => text(node, 'staff'))).toEqual(['1', '1']);
  });
});
