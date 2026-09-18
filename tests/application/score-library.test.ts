// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ScoreLibrary, scoresInOrder, theStarBand, theStarsIn } from '../../src/application/ScoreLibrary.js';
import type { StoredScoreSummary } from '../../src/application/ports/IScoreStore.js';
import { InMemoryScoreStore } from '../../src/application/ports/IScoreStore.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { tiedExercise, twoBarExercise } from '../support/fixtures.js';

function library(store = new InMemoryScoreStore()) {
  const asked: string[] = [];
  return {
    store,
    asked,
    scores: new ScoreLibrary({
      store,
      serializer: new MusicXmlSerializer(),
      importer: new DomScoreImporter(),
      keeper: {
        askToKeep: () => {
          asked.push('keep');
          return Promise.resolve(true);
        },
      },
    }),
  };
}

describe('how hard a piece is said to be', () => {
  it('keeps the reader own judgement with the piece', async () => {
    // Theirs and nothing computed: a number worked out from the notes would be
    // wrong about what actually makes a piece hard to read, and wrong with an
    // authority nobody could argue with. His: "як в osu! від 1 до 10 зірочок".
    const { scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'City of Tears' }), 1_000);

    await scores.keepTheStars(kept.id, 4.5);

    expect(scores.theStarsFor('City of Tears')).toBe(4.5);
  });

  it('takes the mark off again, which is not the same as nought', async () => {
    const { scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'City of Tears' }), 1_000);
    await scores.keepTheStars(kept.id, 4.5);

    await scores.keepTheStars(kept.id, null);

    expect(scores.theStarsFor('City of Tears')).toBeNull();
  });

  it('says nothing about a piece nobody has judged', async () => {
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'City of Tears' }), 1_000);

    expect(scores.theStarsFor('City of Tears')).toBeNull();
  });

  it('survives the library being read back from the store', async () => {
    const store = new InMemoryScoreStore();
    const first = library(store);
    const kept = await first.scores.keep(twoBarExercise({ title: 'City of Tears' }), 1_000);
    await first.scores.keepTheStars(kept.id, 7.3);

    const later = library(store);
    await later.scores.load();

    expect(later.scores.theStarsFor('City of Tears')).toBe(7.3);
  });
});

describe('reading a difficulty the reader typed', () => {
  it('keeps the tenth, which is the precision he asked for', () => {
    // "2.2 2.3 2.7" - and the precision anybody can feel the difference of.
    expect(theStarsIn('2.7')).toBe(2.7);
    expect(theStarsIn('2.74')).toBe(2.7);
    expect(theStarsIn('2.75')).toBe(2.8);
  });

  it('holds it inside one and ten rather than arguing about it', () => {
    // A reader who types 15 means the hardest thing there is, and a dialog that
    // refuses them is a dialog in the way.
    expect(theStarsIn('15')).toBe(10);
    expect(theStarsIn('0')).toBe(1);
    expect(theStarsIn('-3')).toBe(1);
  });

  it('takes a comma, which is what half a keyboard gives for a decimal', () => {
    expect(theStarsIn('3,4')).toBe(3.4);
  });

  it('says nothing about what is not a number', () => {
    expect(theStarsIn('')).toBeNull();
    expect(theStarsIn('   ')).toBeNull();
    expect(theStarsIn('hard')).toBeNull();
  });
});

describe('which star a mark falls in', () => {
  it('takes the whole star, the way anybody says it', () => {
    // A piece marked 2.7 is "a two". The number is printed beside the colour,
    // so nothing is lost to the rounding.
    expect(theStarBand(2.7)).toBe(2);
    expect(theStarBand(2.1)).toBe(2);
    expect(theStarBand(3)).toBe(3);
    expect(theStarBand(9.9)).toBe(9);
  });

  it('keeps the top mark in the top band', () => {
    // Ten is the end of the ramp and not one past it: floored alone, a piece
    // marked exactly 10 would still be a ten, but anything above would fall off
    // a colour list that stops there.
    expect(theStarBand(10)).toBe(10);
    expect(theStarBand(11)).toBe(10);
    expect(theStarBand(0.5)).toBe(1);
  });
});

describe('the order the shelf is read in', () => {
  function shelf(
    rows: readonly { title: string; openedAtMs: number; stars?: number }[],
  ): readonly StoredScoreSummary[] {
    return rows.map((row) => ({
      id: row.title,
      title: row.title,
      savedAtMs: 0,
      openedAtMs: row.openedAtMs,
      bars: 8,
      passages: [],
      ...(row.stars === undefined ? {} : { stars: row.stars }),
    }));
  }

  const SOME = shelf([
    { title: 'Middling', openedAtMs: 3_000, stars: 5 },
    { title: 'Unjudged', openedAtMs: 4_000 },
    { title: 'Gentle', openedAtMs: 1_000, stars: 2.2 },
    { title: 'Brutal', openedAtMs: 2_000, stars: 9.4 },
  ]);

  const titles = (order: 'recent' | 'easiest' | 'hardest'): readonly string[] =>
    scoresInOrder(SOME, order).map((score) => score.title);

  it('leaves the old order alone by default', () => {
    // The piece being worked on is the one kept coming back to.
    expect(titles('recent')).toEqual(['Unjudged', 'Middling', 'Brutal', 'Gentle']);
  });

  it('puts the gentlest first when asked for something readable', () => {
    expect(titles('easiest').slice(0, 3)).toEqual(['Gentle', 'Middling', 'Brutal']);
  });

  it('puts the hardest first when asked for something to stretch on', () => {
    expect(titles('hardest').slice(0, 3)).toEqual(['Brutal', 'Middling', 'Gentle']);
  });

  it('stands an unjudged piece at the end, never at the easy end', () => {
    // Unmarked is not easy. Sorted as nought, everything nobody has opened
    // would be handed to the reader looking for something gentle.
    expect(titles('easiest')[3]).toBe('Unjudged');
    expect(titles('hardest')[3]).toBe('Unjudged');
  });

  it('falls back on the recent order among equals', () => {
    // Every row still has a reason to be where it is.
    const tied = shelf([
      { title: 'Older', openedAtMs: 1_000, stars: 4 },
      { title: 'Newer', openedAtMs: 2_000, stars: 4 },
    ]);

    expect(scoresInOrder(tied, 'easiest').map((score) => score.title)).toEqual(['Newer', 'Older']);
  });

  it('does not reorder the list it was handed', () => {
    const given = shelf([
      { title: 'Gentle', openedAtMs: 1_000, stars: 2 },
      { title: 'Brutal', openedAtMs: 2_000, stars: 9 },
    ]);
    const before = given.map((score) => score.title);

    scoresInOrder(given, 'hardest');

    expect(given.map((score) => score.title)).toEqual(before);
  });
});

describe('the click a piece asks for', () => {
  it('keeps it with the piece, so it is waiting next time', async () => {
    // His: "choral chambers has two clicks in a base metronome setting, and I
    // need to choose to hear more clicks, and when I switch to another song -
    // I don't want to hear that many ticks - and I need to switch again".
    const { scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'Choral Chambers' }), 1_000);

    await scores.keepTheClick(kept.id, 'subdivision');

    expect(scores.theClickFor('Choral Chambers')).toBe('subdivision');
  });

  it('says nothing about a piece nobody has chosen for', async () => {
    // Nothing is the instruction to leave the reader's own setting alone. A
    // default here would make every score ever imported quietly override it.
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'Something Borrowed' }), 1_000);

    expect(scores.theClickFor('Something Borrowed')).toBeNull();
  });

  it('says nothing about a piece that is not kept at all', () => {
    const { scores } = library();

    expect(scores.theClickFor('A piece nobody imported')).toBeNull();
  });

  it('keeps one piece answer out of another', async () => {
    const { scores } = library();
    const one = await scores.keep(twoBarExercise({ title: 'Choral Chambers' }), 1_000);
    await scores.keep(twoBarExercise({ title: 'City of Tears' }), 2_000);

    await scores.keepTheClick(one.id, 'division');

    expect(scores.theClickFor('Choral Chambers')).toBe('division');
    expect(scores.theClickFor('City of Tears')).toBeNull();
  });

  it('survives the library being read back from the store', async () => {
    // The point of keeping it: a reader coming back next week, which is a new
    // library over the same store.
    const store = new InMemoryScoreStore();
    const first = library(store);
    const kept = await first.scores.keep(twoBarExercise({ title: 'Choral Chambers' }), 1_000);
    await first.scores.keepTheClick(kept.id, 'subdivision');

    const later = library(store);
    await later.scores.load();

    expect(later.scores.theClickFor('Choral Chambers')).toBe('subdivision');
  });
});

describe('the places marked out in a piece', () => {
  /** A kept score to mark places out in, since a generated one has none. */
  async function marked(places: readonly { name: string; fromBar: number; toBar: number }[]) {
    const { scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'Something Borrowed' }), 1_000);
    await scores.keepPassages(kept.id, places);
    return scores;
  }

  it('reads in the order the piece is played, not the order they were marked', async () => {
    // A list in the order things happened to be marked out is a list to be
    // searched. In bar order it is the piece, and the row above the one you
    // want is the passage before it.
    // Two of them start in the same bar, and in the order that would come
    // out wrong if only the first bar were compared.
    const scores = await marked([
      { name: 'The coda', fromBar: 9, toBar: 12 },
      { name: 'The whole second half', fromBar: 3, toBar: 12 },
      { name: 'The turn', fromBar: 3, toBar: 4 },
    ]);

    expect(scores.passagesOf('Something Borrowed').map((place) => place.name)).toEqual([
      'The turn',
      'The whole second half',
      'The coda',
    ]);
  });

  it('keeps one row for one place, however often it is marked out', async () => {
    // A place is its two bars. Marking out bars 3-4 again is the reader
    // naming the same stretch, not finding a second one - and two rows
    // reading "bars 3-4" are a list they could tell apart by nothing at all.
    const scores = await marked([
      { name: 'The turn', fromBar: 3, toBar: 4 },
      { name: 'The awkward turn', fromBar: 3, toBar: 4 },
    ]);

    expect(scores.passagesOf('Something Borrowed')).toEqual([
      { name: 'The awkward turn', fromBar: 3, toBar: 4 },
    ]);
  });

  it('puts in order what an older version of this program left unordered', async () => {
    // The reason reading sorts as well as writing: a score marked out before
    // any of this existed is still on the reader's device, written in
    // whatever order they happened to mark it out.
    const { store, scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'Something Borrowed' }), 1_000);
    const found = await store.read(kept.id);
    if (found === null) {
      throw new Error('expected the score to be there');
    }
    // Straight past the library, which is how those records were written.
    await store.write({
      ...found,
      passages: [
        { name: 'The coda', fromBar: 9, toBar: 12 },
        { name: 'The turn', fromBar: 3, toBar: 4 },
      ],
    });
    await scores.load();

    expect(scores.passagesOf('Something Borrowed').map((place) => place.name)).toEqual([
      'The turn',
      'The coda',
    ]);
  });

  it('puts them in order on the way in as well, so what is stored is ordered', async () => {
    const { store, scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'Something Borrowed' }), 1_000);

    await scores.keepPassages(kept.id, [
      { name: 'The coda', fromBar: 9, toBar: 12 },
      { name: 'The turn', fromBar: 3, toBar: 4 },
    ]);

    const stored = await store.read(kept.id);
    expect(stored?.passages.map((place) => place.fromBar)).toEqual([3, 9]);
  });
});

describe('the scores a reader has kept', () => {
  it('says nothing before anything has been opened', async () => {
    const { scores } = library();
    await scores.load();

    expect(scores.isEmpty).toBe(true);
    expect(scores.list()).toEqual([]);
  });

  it('gives back the same music it was handed', async () => {
    const { scores } = library();
    const original = twoBarExercise({ title: 'Something Borrowed' });
    const kept = await scores.keep(original, 1_000);

    const reopened = await scores.open(kept.id);
    if (reopened === null) {
      throw new Error('expected the score to come back');
    }

    // The stored document is this project's own MusicXML and the reader is
    // this project's own parser, so what comes back is the same piece - not
    // merely something that looks like it.
    expect(reopened.title).toBe('Something Borrowed');
    expect(buildTimeline(reopened).length).toBe(buildTimeline(original).length);
    expect(new MusicXmlSerializer().serialize(reopened)).toBe(
      new MusicXmlSerializer().serialize(original),
    );
  });

  it('keeps what makes a piece worth recognising in a list', async () => {
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'Two Bars' }), 1_000);

    const [summary] = scores.list();
    expect(summary?.title).toBe('Two Bars');
    expect(summary?.bars).toBe(2);
    expect(summary?.savedAtMs).toBe(1_000);
  });

  it('survives the visit that kept it', async () => {
    const store = new InMemoryScoreStore();
    await library(store).scores.keep(twoBarExercise({ title: 'Kept' }), 1_000);

    const next = library(store).scores;
    await next.load();

    expect(next.list().map((score) => score.title)).toEqual(['Kept']);
  });

  it('replaces a piece rather than keeping two of it', async () => {
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'Same Piece' }), 1_000);
    await scores.keep(tiedExercise({ title: 'Same Piece' }), 2_000);

    // Opening the file again after editing it should update the entry, not
    // leave two rows that differ invisibly.
    expect(scores.list()).toHaveLength(1);
    expect(scores.list()[0]?.savedAtMs).toBe(2_000);
  });

  it('puts the newest first', async () => {
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'Older' }), 1_000);
    await scores.keep(twoBarExercise({ title: 'Newer' }), 5_000);

    expect(scores.list().map((score) => score.title)).toEqual(['Newer', 'Older']);
  });

  it('forgets one without touching the others', async () => {
    const { scores } = library();
    const first = await scores.keep(twoBarExercise({ title: 'Goes' }), 1_000);
    await scores.keep(twoBarExercise({ title: 'Stays' }), 2_000);

    await scores.remove(first.id);

    expect(scores.list().map((score) => score.title)).toEqual(['Stays']);
    expect(await scores.open(first.id)).toBeNull();
  });

  it('forgets everything when asked', async () => {
    const { scores } = library();
    await scores.keep(twoBarExercise(), 1_000);

    await scores.forget();

    expect(scores.isEmpty).toBe(true);
  });

  it('answers for a score that is no longer there', async () => {
    const { scores } = library();
    expect(await scores.open('score:Never Kept')).toBeNull();
  });

  it('puts the score read most recently at the top', async () => {
    // The list said "newest first: the score a reader wants is usually the
    // last one opened" and then sorted on when each was *kept*, which is the
    // same order only on the day the files arrived. A month later the piece
    // being worked on sits wherever its file happened to land.
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'Imported First' }), 1_000);
    await scores.keep(twoBarExercise({ title: 'Imported Second' }), 2_000);

    expect(scores.list().map((score) => score.title)).toEqual([
      'Imported Second',
      'Imported First',
    ]);

    await scores.markRead('Imported First', 3_000);

    expect(scores.list().map((score) => score.title)).toEqual([
      'Imported First',
      'Imported Second',
    ]);
  });

  it('remembers what was read last across a visit', async () => {
    // The stamp is on the score in the store, not in a list held in memory:
    // a reader who opens something and comes back tomorrow should find it
    // where they left it.
    const store = new InMemoryScoreStore();
    const first = library(store);
    await first.scores.keep(twoBarExercise({ title: 'Older' }), 1_000);
    await first.scores.keep(twoBarExercise({ title: 'Newer' }), 2_000);
    await first.scores.markRead('Older', 3_000);

    const next = library(store);
    await next.scores.load();

    expect(next.scores.list().map((score) => score.title)).toEqual(['Older', 'Newer']);
  });

  it('is read when the reader reads it, not when the program offers it', async () => {
    // The program can be asked to put a random score on the stand when the
    // page opens. If merely opening one counted, the machine's own choice
    // would push itself to the top of the list every visit and lose the
    // piece actually being worked on - so opening and reading are separate,
    // and only the second of them is a claim about anything.
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'Older' }), 1_000);
    await scores.keep(twoBarExercise({ title: 'Newer' }), 2_000);

    await scores.open('score:Older');

    expect(scores.list().map((score) => score.title)).toEqual(['Newer', 'Older']);
  });

  it('offers one of the kept scores for a number between nought and one', async () => {
    // The randomness stays with the caller, so this layer is as testable as
    // the rest and `Math.random` lives at the edge with the other things the
    // page has and the rules do not.
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'First' }), 2_000);
    await scores.keep(twoBarExercise({ title: 'Second' }), 1_000);

    expect(scores.oneAtRandom(0)?.title).toBe('First');
    expect(scores.oneAtRandom(0.99)?.title).toBe('Second');
    // A one is what a random number generator promises never to give, and it
    // must not fall off the end of the shelf on the day one does.
    expect(scores.oneAtRandom(1)?.title).toBe('Second');
  });

  it('has nothing to offer from an empty shelf', async () => {
    const { scores } = library();
    await scores.load();

    expect(scores.oneAtRandom(0.5)).toBeNull();
    expect(scores.lastRead).toBeNull();
  });

  it('renames the document and not merely the row', async () => {
    // The title is printed in the corner of every page, so a library that
    // called a piece one thing while the page called it another would be
    // worse than either name on its own.
    const { scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'Imported score' }), 1_000);

    expect(await scores.rename(kept.id, '  Merry Christmas Mr Lawrence  ')).toBe('renamed');

    const [summary] = scores.list();
    expect(summary?.title).toBe('Merry Christmas Mr Lawrence');
    expect(scores.list()).toHaveLength(1);
    const reopened = await scores.open(summary?.id ?? '');
    expect(reopened?.title).toBe('Merry Christmas Mr Lawrence');
  });

  it('keeps when a renamed score arrived and when it was read', async () => {
    // A rename is not a reading and not an import: a piece does not become
    // new by being called something else.
    const { scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'Old' }), 1_000);
    await scores.markRead('Old', 5_000);

    await scores.rename(kept.id, 'New');

    const [summary] = scores.list();
    expect(summary?.savedAtMs).toBe(1_000);
    expect(summary?.openedAtMs).toBe(5_000);
  });

  it('refuses a name that would write over another score', async () => {
    // The title is this library's idea of identity - `keep` replaces an
    // entry of the same name on purpose, so obeying here would silently
    // delete the other piece.
    const { scores } = library();
    const first = await scores.keep(twoBarExercise({ title: 'One' }), 1_000);
    await scores.keep(twoBarExercise({ title: 'Two' }), 2_000);

    expect(await scores.rename(first.id, 'Two')).toBe('taken');
    expect(scores.list().map((score) => score.title)).toEqual(['Two', 'One']);
  });

  it('refuses to leave a score with no name at all', async () => {
    const { scores } = library();
    const kept = await scores.keep(twoBarExercise({ title: 'Named' }), 1_000);

    expect(await scores.rename(kept.id, '   ')).toBe('empty');
    expect(scores.list()[0]?.title).toBe('Named');
  });

  it('says when there is nothing there to rename', async () => {
    const { scores } = library();
    await scores.load();

    expect(await scores.rename('score:Gone', 'Anything')).toBe('missing');
  });

  it('finds a score by any of the words in its name', async () => {
    // His library is arrangements with names like "Hollow Knight - City of
    // Tears", and what he remembers of one is rarely its first word. Every
    // word has to appear; the order they are typed in is not a claim.
    const { scores } = library();
    await scores.keep(twoBarExercise({ title: 'Hollow Knight - City of Tears' }), 1_000);
    await scores.keep(twoBarExercise({ title: 'Clair de Lune' }), 2_000);

    expect(scores.search('city tears').map((score) => score.title)).toEqual([
      'Hollow Knight - City of Tears',
    ]);
    expect(scores.search('TEARS city').map((score) => score.title)).toEqual([
      'Hollow Knight - City of Tears',
    ]);
    expect(scores.search('lune').map((score) => score.title)).toEqual(['Clair de Lune']);
    expect(scores.search('nocturne')).toEqual([]);
    // An empty search is not a search: everything, in the order it was in.
    expect(scores.search('  ').map((score) => score.title)).toEqual([
      'Clair de Lune',
      'Hollow Knight - City of Tears',
    ]);
  });

  it('does not carry the documents around in the list', async () => {
    const store = new InMemoryScoreStore();
    const { scores } = library(store);
    await scores.keep(twoBarExercise({ title: 'Heavy' }), 1_000);

    // A list of ten scores would otherwise hold megabytes of MusicXML that
    // nothing is about to read.
    for (const summary of await store.list()) {
      expect('musicXml' in summary).toBe(false);
    }
  });
});

describe('asking the device to keep the library', () => {
  it('asks once there is a score to keep, and not before', async () => {
    // A browser may clear a site's store to make room, and Safari clears one
    // unvisited for a week: a library of scores with a difficulty given to
    // each is nowhere else. One browser asks the reader out loud, so a page
    // with nothing in it asks nothing.
    const { scores, asked } = library();
    await scores.load();
    expect(asked).toEqual([]);

    await scores.keep(twoBarExercise({ title: 'City of Tears' }), 1_000);

    expect(asked.length).toBeGreaterThan(0);
  });

  it('asks on a visit to a library that already holds something', async () => {
    const store = new InMemoryScoreStore();
    await library(store).scores.keep(twoBarExercise({ title: 'City of Tears' }), 1_000);
    const visit = library(store);

    await visit.scores.load();

    expect(visit.asked).toEqual(['keep']);
  });
});
