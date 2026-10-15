import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  /** The lines a second each, under the columns' heading, their spaces closed up. */
  const rows = (): string[] => {
    const lines = timings.thePlaybackTimingsText('a tablet').split('\n');
    return lines
      .slice(lines.findIndex((line) => line.trim().startsWith('sec notes')) + 1)
      .map((line) => line.trim().replace(/\s+/g, ' '));
  };

  it('keeps nothing before the pulse starts', () => {
    timings.noteANoteHanded(1_200, false, null);
    timings.noteABeatShown(900);
    timings.noteAFrame();

    expect(rows()).toEqual(['Nothing yet: start a playback, and copy this after it.']);
  });

  it('says of each second how far ahead notes were handed, how late the beats were acted on, and the longest frame', () => {
    timings.beginThePlaybackTimings();
    const clocks = { driftMs: 2, heardOffMs: null, outputMs: 40, baseMs: 5 };
    now = 1_100;
    // Handed 200 ms ahead; on its moment, which is not late; 50 ms late,
    // sounded; 300 ms late, dropped; and one with no moment.
    timings.noteANoteHanded(1_300, false, clocks);
    timings.noteANoteHanded(1_100, false, clocks);
    now = 1_150;
    timings.noteANoteHanded(1_100, false, { ...clocks, driftMs: 3.4, heardOffMs: 12.6 });
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

    expect(rows()).toEqual(['0 4 -300 1 1 +3 +13 40/ 5 2 70 3 84 - -', '1 0 - 0 0 - - -/ - 0 - 2 500 - -']);
    const text = timings.thePlaybackTimingsText('a tablet');
    expect(text.split('\n').slice(0, 2)).toEqual(['How the last playback kept time', 'a tablet']);
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

    expect(rows()).toEqual(['0 0 - 0 0 - - -/ - 0 - 2 10 - -']);
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
