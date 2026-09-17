/** What the page is sounding, and who answers the keys that control it. */
export interface WhatIsSounding {
  /** What the controls should name, which is the piece being played. */
  readonly title: string;
  /** False where it is being held rather than played. */
  readonly playing: boolean;
  readonly play: () => void;
  readonly pause: () => void;
  readonly stop: () => void;
}

/**
 * The transport keys the platform has outside this page.
 *
 * The keys on a keyboard, the buttons on a pair of headphones, and the panel a
 * phone or tablet puts on its lock screen. What they have in common is that
 * they reach a page nobody is looking at, which is the whole reason for this:
 * he sets a piece playing on a loop, goes elsewhere, and to stop it has to find
 * the tab again. His: "I like to enable a music on a loop and just listen to
 * it, but if I need to stop it - I need to focus the page and pause it
 * normally".
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
