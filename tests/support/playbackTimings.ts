/**
 * The latest playback of the timings' text, read back: its seconds, each a
 * line cut at its spaces, and what happened in it, each without its time.
 */
export function theLatestPlayback(text: string): { readonly rows: string[][]; readonly happened: string[] } {
  const lines = text.split('\n');
  const from = lines.indexOf('The latest playback:');
  const after = lines.slice(from + 2);
  const ends = after.indexOf('');
  const section = ends < 0 ? after : after.slice(0, ends);
  const happenedAt = section.indexOf('What happened, ms since the pulse started:');
  const table = happenedAt < 0 ? section : section.slice(0, happenedAt);
  return {
    rows: table.filter((line) => /^ *\d/.test(line)).map((line) => line.trim().split(/ +/)),
    happened: happenedAt < 0 ? [] : section.slice(happenedAt + 1).map((line) => line.trim().replace(/^[+-]?\d+ +/, '')),
  };
}
