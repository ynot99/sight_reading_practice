/** A moment to the second, and its day: what a title made from one goes by. */
export function whenItWas(atMs: number): string {
  const at = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}, ${theDayItWas(atMs)}`;
}

/**
 * The day something was, without the time: what a sketch is named by, so its
 * name fits beside its buttons on a phone and still says when it was begun.
 */
export function theDayItWas(atMs: number): string {
  const at = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}`;
}
