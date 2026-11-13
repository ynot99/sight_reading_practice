/**
 * Puts a failure where it can be copied from.
 *
 * The notice on the page says what went wrong in one sentence, which is what
 * a reader needs mid-practice and all there is room for. It cannot be
 * selected on a tablet and it carries no stack, so a fault the reader wants
 * to report has to be read off the screen by hand - the reader asked for
 * this after doing exactly that.
 */
export function reportToTheConsole(what: string, error: unknown): void {
  console.error(what, error);
}
