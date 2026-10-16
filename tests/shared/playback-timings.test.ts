import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theLatestPlayback } from '../support/playbackTimings.js';

type Timings = typeof import('../../src/shared/playbackTimings.js');

describe('how a playback kept time', () => {
  let now = 0;
  let timings: Timings;

  beforeEach(async () => {
    now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    // Fresh each time: the timings are the module's own.
    vi.resetModules();
    timings = await import('../../src/shared/playbackTimings.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The latest playback's lines a second each, their spaces closed up. */
  const rows = (): string[] => theLatestPlayback(timings.thePlaybackTimingsText('a tablet')).rows.map((row) => row.join(' '));

  it('keeps nothing before the pulse starts', () => {
    timings.noteANoteHanded(1_200, false, null);
    timings.noteABeatShown(900);
    timings.noteAFrame();

    expect(rows()).toEqual([]);
    expect(timings.thePlaybackTimingsText('')).toContain('Nothing yet: start a playback, and copy this after it.');
  });

  it('says of each second how far ahead notes were handed, how late the beats were acted on, and the longest frame', () => {
    timings.beginThePlaybackTimings();
    const clocks = { driftMs: 2, outputMs: 40, baseMs: 5 };
    now = 1_100;
    // Handed 200 ms ahead; on its moment, which is not late; 50 ms late,
    // sounded; 300 ms late, dropped; and one with no moment.
    timings.noteANoteHanded(1_300, false, clocks);
    timings.noteANoteHanded(1_100, false, clocks);
    now = 1_150;
    timings.noteANoteHanded(1_100, false, { ...clocks, driftMs: 3.4 });
    now = 1_200;
    timings.noteANoteHanded(900, true, null);
    timings.noteANoteHanded(undefined, false, clocks);
    now = 1_300;
    timings.noteABeatShown(1_290);
    now = 1_400;
    timings.noteABeatShown(1_330);
    for (const at of [1_500, 1_516, 1_600]) {
      now = at;
      timings.noteAFrame();
    }
    // The next second: a stall of half a second between frames, and frames
    // stopped and begun again, which is no stall.
    now = 2_100;
    timings.noteAFrame();
    timings.noteTheFramesStopped();
    now = 2_900;
    timings.noteAFrame();

    expect(rows()).toEqual(['0 4 -300 1 1 +3 40/ 5 2 70 3 84 - -', '1 0 - 0 0 - -/ - 0 - 2 500 - -']);
    const text = timings.thePlaybackTimingsText('a tablet');
    expect(text.split('\n').slice(0, 2)).toEqual(['How the last playbacks kept time, the latest first', 'a tablet']);
  });

  it('begins again with the pulse', () => {
    timings.beginThePlaybackTimings();
    now = 1_100;
    timings.noteABeatShown(1_000);
    timings.noteAFrame();
    now = 5_000;
    timings.beginThePlaybackTimings();
    now = 5_050;
    timings.noteAFrame();
    now = 5_060;
    timings.noteAFrame();

    expect(rows()).toEqual(['0 0 - 0 0 - -/ - 0 - 2 10 - -']);
  });

  it('says where the audio clock stood against its first look, and where its reading was taken again', () => {
    timings.noteTheAudioNought(500);
    timings.noteTheClocksReadAgain(9);
    // A pulse before this one saw it elsewhere, which this one does not count from.
    timings.beginThePlaybackTimings();
    timings.noteTheAudioNought(700);
    timings.beginThePlaybackTimings();
    now = 1_100;
    timings.noteTheAudioNought(400);
    now = 1_120;
    timings.noteTheAudioNought(410);
    timings.noteTheAudioNought(398);
    // Then the audio clock stands 92 ms, and the reading follows it twice.
    now = 2_100;
    timings.noteTheAudioNought(492);
    timings.noteTheAudioNought(495);
    timings.noteTheClocksReadAgain(80);
    timings.noteTheClocksReadAgain(12);

    expect(rows().map((row) => row.split(' ').slice(-2))).toEqual([
      ['-2', '-'],
      ['+92', '+92'],
    ]);
  });

  it('lists what happened once under the seconds, from the pulse\'s start, and only since it', () => {
    timings.noteAnEvent('before anything');
    timings.beginThePlaybackTimings();
    timings.noteAnEvent('from an earlier pulse');
    now = 2_000;
    timings.beginThePlaybackTimings();
    now = 2_040;
    timings.noteAnEvent('the clocks read');
    now = 2_400;
    timings.noteAnEvent('the audio clock had stood 134 ms');
    const lines = timings.thePlaybackTimingsText('a tablet').split('\n');
    const latest = lines.slice(lines.indexOf('The latest playback:'));

    expect(latest.slice(latest.indexOf('What happened, ms since the pulse started:'), latest.indexOf(''))).toEqual([
      'What happened, ms since the pulse started:',
      '    +40  the clocks read',
      '   +400  the audio clock had stood 134 ms',
    ]);
  });

  it('keeps no more than two hundred of them', () => {
    timings.beginThePlaybackTimings();
    for (let at = 0; at < 250; at += 1) {
      timings.noteAnEvent(`event ${String(at)}`);
    }
    const { happened } = theLatestPlayback(timings.thePlaybackTimingsText(''));

    expect(happened).toHaveLength(200);
    expect(happened.at(-1)).toBe('event 199');
  });

  it('keeps the two playbacks before the latest, as they were, the latest first', () => {
    for (const [at, what] of [
      [1_000, 'first'],
      [2_000, 'second'],
      [3_000, 'third'],
      [4_000, 'fourth'],
    ] as const) {
      now = at;
      timings.beginThePlaybackTimings();
      timings.noteAnEvent(what);
    }
    // And a pulse begun again with nothing come of it is not kept over the
    // one before - a run's pulse begins again often.
    now = 5_000;
    timings.beginThePlaybackTimings();
    timings.beginThePlaybackTimings();
    now = 5_500;
    timings.noteAFrame();

    const lines = timings.thePlaybackTimingsText('').split('\n');
    const said = lines.filter((line) => /^The |^[+ ]+\d+ {2}\w/.test(line)).map((line) => line.trim().replace(/^\+?\d+ +/, ''));
    expect(said).toEqual(['The latest playback:', 'The one before it:', 'fourth', 'The one before that:', 'third']);
  });

  it('keeps the last quarter of an hour', () => {
    timings.beginThePlaybackTimings();
    now = 1_000;
    timings.noteAFrame();
    now = 1_000 + 899_500;
    timings.noteAFrame();
    expect(rows().map((row) => row.split(' ')[0])).toEqual(['0', '899']);
    now = 1_000 + 900_000;
    timings.noteAFrame();
    expect(rows().map((row) => row.split(' ')[0])).toEqual(['899', '900']);
  });
});
