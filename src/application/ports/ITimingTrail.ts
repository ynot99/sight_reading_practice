/**
 * Where the start timings are kept as they are printed.
 *
 * The console goes with the page, and the page that most needs its timings
 * read is the one the browser closed in the middle of them - his Alkan, which
 * the iPad closes while it is being engraved, before anything can be copied
 * out. So each line is kept as well, somewhere the next visit can read it.
 */
export interface ITimingTrail {
  keep(lines: readonly string[]): void;
  /** The lines kept last, or none. */
  lastKept(): readonly string[];
}
