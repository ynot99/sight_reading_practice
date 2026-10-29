/**
 * How many answers at the end of these were right one after another: nought
 * just after one that was not. A round of naming and music played back ask
 * the same of their answers, so one answer.
 */
export function rightInARowAtTheEnd(rights: readonly boolean[]): number {
  let run = 0;
  for (const right of rights) {
    run = right ? run + 1 : 0;
  }
  return run;
}

/** The most answers right one after another among these. */
export function mostRightInARow(rights: readonly boolean[]): number {
  let most = 0;
  let run = 0;
  for (const right of rights) {
    run = right ? run + 1 : 0;
    most = Math.max(most, run);
  }
  return most;
}
