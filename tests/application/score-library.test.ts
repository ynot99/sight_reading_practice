// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ScoreLibrary } from '../../src/application/ScoreLibrary.js';
import { InMemoryScoreStore } from '../../src/application/ports/IScoreStore.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { tiedExercise, twoBarExercise } from '../support/fixtures.js';

function library(store = new InMemoryScoreStore()) {
  return {
    store,
    scores: new ScoreLibrary({
      store,
      serializer: new MusicXmlSerializer(),
      importer: new DomScoreImporter(),
    }),
  };
}

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

    const reopened = await scores.open(kept.id, 2_000);
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
    expect(await scores.open(first.id, 3_000)).toBeNull();
  });

  it('forgets everything when asked', async () => {
    const { scores } = library();
    await scores.keep(twoBarExercise(), 1_000);

    await scores.forget();

    expect(scores.isEmpty).toBe(true);
  });

  it('answers for a score that is no longer there', async () => {
    const { scores } = library();
    expect(await scores.open('score:Never Kept', 1_000)).toBeNull();
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

    await scores.open('score:Imported First', 3_000);

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
    await first.scores.open('score:Older', 3_000);

    const next = library(store);
    await next.scores.load();

    expect(next.scores.list().map((score) => score.title)).toEqual(['Older', 'Newer']);
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
