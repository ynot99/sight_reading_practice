/**
 * The latest playback of the timings' text, read back: its seconds, each a
 * line cut at its spaces, and what happened in it, each without its time -
 * from its start on, and apart from that what happened just before it.
 */
export function theLatestPlayback(text: string): {
  readonly rows: string[][];
  readonly happened: string[];
  readonly before: string[];
} {
  const lines = text.split('\n');
  const from = lines.indexOf('The latest playback:');
  const after = lines.slice(from + 2);
  const ends = after.indexOf('');
  const section = ends < 0 ? after : after.slice(0, ends);
  const happenedAt = section.indexOf('What happened, ms since the pulse started:');
  const table = happenedAt < 0 ? section : section.slice(0, happenedAt);
  const entries = (happenedAt < 0 ? [] : section.slice(happenedAt + 1)).map((line) => {
    const [, at = '0', what = ''] = /^\s*([+-]?\d+)\s+(.*)$/.exec(line) ?? [];
    return { at: Number(at), what };
  });
  return {
    rows: table.filter((line) => /^ *\d/.test(line)).map((line) => line.trim().split(/ +/)),
    happened: entries.filter(({ at }) => at >= 0).map(({ what }) => what),
    before: entries.filter(({ at }) => at < 0).map(({ what }) => what),
  };
}
