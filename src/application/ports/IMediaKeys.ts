/** What the page is sounding, and who answers the keys that control it. */
export interface WhatIsSounding {
  /** What the controls should name, which is the piece being played. */
  readonly title: string;
  /** False where it is being held rather than played. */
  readonly playing: boolean;
  readonly play: () => void;
  readonly pause: () => void;
  readonly stop: () => void;
  /**
   * Where it stands now, and how long it is, in milliseconds; `null` where it
   * cannot say. Asked rather than told, since a key pressed to skip on is
   * pressed some time after the page last said anything.
   */
  readonly placeNow: () => { readonly positionMs: number; readonly durationMs: number } | null;
  /** Moves it to a moment, playing on from there or held there as it was. */
  readonly seekTo: (positionMs: number) => void;
}

/**
 * The transport keys the platform has outside this page.
 *
 * The keys on a keyboard, the buttons on a pair of headphones, and the panel a
 * phone or tablet puts on its lock screen. What they have in common is that
 * they reach a page nobody is looking at, which is the whole reason for this:
 * a piece left playing on a loop while the reader works in another window can
 * be held or stopped without finding the tab again.
 *
 * Held only while something is sounding. A page that keeps the keys after its
 * music has ended is a page that swallows them from whatever the reader plays
 * next, and a media key that does nothing is worse than one that goes
 * somewhere else.
 */
export interface IMediaKeys {
  /**
   * Says what is sounding and who answers for it; `null` gives the keys back.
   *
   * One call rather than one for the state and one for the handlers, because
   * the two have to agree: a panel showing Pause over music that has stopped is
   * exactly what two calls drift into.
   */
  sounding(what: WhatIsSounding | null): void;
}

/** Null object for tests and for anywhere with no platform to ask. */
export class NoMediaKeys implements IMediaKeys {
  sounding(): void {
    // Intentionally nothing.
  }
}
