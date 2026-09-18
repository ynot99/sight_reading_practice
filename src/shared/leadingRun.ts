import { elementAt } from './asserts.js';

/**
 * The index of the last item in a leading run that passes `test`, or -1 when
 * the first item already fails it.
 *
 * For a list in order and a test that holds up to some point and never again
 * after it - "has begun by this moment" - which is the question every one of
 * a piece's time-ordered lists is asked. Found by halving rather than by
 * walking, so the thousandth bar of a long piece costs a few more steps than
 * the first, not a thousand bars' worth.
 */
export function lastOfLeadingRun<T>(items: readonly T[], test: (item: T) => boolean): number {
  let passed = 0;
  let unknown = items.length;
  while (passed < unknown) {
    const middle = (passed + unknown) >>> 1;
    if (test(elementAt(items, middle))) {
      passed = middle + 1;
    } else {
      unknown = middle;
    }
  }
  return passed - 1;
}
