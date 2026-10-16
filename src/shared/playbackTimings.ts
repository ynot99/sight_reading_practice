/**
 * How a playback kept time, second by second, for a device nobody here can
 * hold: when each note was handed to the instrument against when it was to be
 * heard, how far the audio clock had moved from the page's, how late the page
 * acted on each beat, and how long it went between two frames of the falling
 * notes.
 *
 * Kept because a playback seen out of step with its sound is four clocks that
 * can each be the late one - the scheduler, the audio device, the page acting
 * on a beat, and the frames - and from outside they all look the same. Held
 * here rather than threaded through the callers, for the reason
 * `timeTheStart` is: the metronome, both instruments, the player and the page
 * each have one line to add, and the page reads it out.
 */

/** What one second of the playback did. */
interface Second {
  handed: number;
  leastAheadMs: number | null;
  late: number;
  dropped: number;
  driftMs: number | null;
  outputMs: number | null;
  baseMs: number | null;
  ticks: number;
  latestTickMs: number | null;
  frames: number;
  longestFrameMs: number | null;
  earliestNoughtMs: number | null;
  readAgainMs: number | null;
}

/** How many seconds are kept: the last quarter of an hour. */
const SECONDS_KEPT = 900;

let began: number | null = null;
let lastFrameAt: number | null = null;
/** What happened once, and when: see `noteAnEvent`. */
const events: { readonly atMs: number; readonly what: string }[] = [];
/** How many events are kept: enough for a start, never a growing list. */
const EVENTS_KEPT = 200;
/** What happened lately, on the page's clock, for a pulse to begin with what came just before it. */
const lately: { readonly at: number; readonly what: string }[] = [];
const LATELY_KEPT = 20;
/** How long before a pulse begins what happened is still its own. */
const BEFORE_THE_START_MS = 3_000;
/** How long between two frames of the falling notes is told as the page having stood. */
const FRAMES_STOOD_MS = 100;
/** The playbacks before the last, as they were written out, the latest first. */
const earlier: string[][] = [];
/** How many playbacks before the last are kept. */
const EARLIER_KEPT = 2;
/** Where the pulse first saw the audio clock's nought on the page's clock, since it started. */
let firstNought: number | null = null;
const seconds = new Map<number, Second>();

/** The second a moment falls in, made where there is none yet; `null` before anything began. */
function theSecondOf(now: number): Second | null {
  if (began === null) {
    return null;
  }
  const at = Math.floor((now - began) / 1000);
  let second = seconds.get(at);
  if (second === undefined) {
    second = {
      handed: 0,
      leastAheadMs: null,
      late: 0,
      dropped: 0,
      driftMs: null,
      outputMs: null,
      baseMs: null,
      ticks: 0,
      latestTickMs: null,
      frames: 0,
      longestFrameMs: null,
      earliestNoughtMs: null,
      readAgainMs: null,
    };
    seconds.set(at, second);
    for (const old of seconds.keys()) {
      if (old > at - SECONDS_KEPT) {
        break;
      }
      seconds.delete(old);
    }
  }
  return second;
}

function least(kept: number | null, value: number): number {
  return kept === null ? value : Math.min(kept, value);
}

function most(kept: number | null, value: number): number {
  return kept === null ? value : Math.max(kept, value);
}

/** Begins the timings again, as the pulse starts. */
export function beginThePlaybackTimings(): void {
  // The one before kept as it was, for a start that went wrong to be copied
  // after the next one too: the first start of a page is not like the rest.
  // Nothing come of it is no playback, whatever came just before it.
  if (seconds.size > 0 || events.some(({ atMs }) => atMs >= 0)) {
    earlier.unshift(thisPlayback());
    earlier.splice(EARLIER_KEPT);
  }
  began = performance.now();
  lastFrameAt = null;
  firstNought = null;
  seconds.clear();
  // Begun with what happened just before it, before nought: the page asks for
  // the media keys' silence as it asks for the music, ahead of the pulse.
  const from = began - BEFORE_THE_START_MS;
  events.splice(
    0,
    events.length,
    ...lately.filter(({ at }) => at >= from && at < (began ?? at)).map(({ at, what }) => ({ atMs: at - (began ?? at), what })),
  );
}

/**
 * Something that happened once, at a moment worth setting beside the
 * seconds: the clocks read, the audio clock standing, the media keys'
 * silence beginning to play.
 */
export function noteAnEvent(what: string): void {
  const now = performance.now();
  lately.push({ at: now, what });
  lately.splice(0, lately.length - LATELY_KEPT);
  if (began === null || events.length >= EVENTS_KEPT) {
    return;
  }
  events.push({ atMs: now - began, what });
}

/**
 * Where the pulse saw the audio clock's nought on the page's clock, at one of
 * its looks: kept as the earliest of each second, against the first look.
 */
export function noteTheAudioNought(noughtMs: number): void {
  const second = theSecondOf(performance.now());
  if (second === null) {
    return;
  }
  firstNought ??= noughtMs;
  second.earliestNoughtMs = least(second.earliestNoughtMs, noughtMs - firstNought);
}

/** The pulse took the clocks' difference again, moving its reading by so much. */
export function noteTheClocksReadAgain(movedMs: number): void {
  const second = theSecondOf(performance.now());
  if (second === null) {
    return;
  }
  second.readAgainMs = (second.readAgainMs ?? 0) + movedMs;
}

/** What the audio device says of its clock as a note is handed over. */
export interface TheAudioClocks {
  /** How far the audio clock's nought now stands from where the pulse read it, in ms of the page's clock. */
  readonly driftMs: number;
  readonly outputMs: number | null;
  readonly baseMs: number | null;
}

/**
 * A note handed to the instrument, to be heard at a moment on the page's
 * clock - or dropped as already gone.
 */
export function noteANoteHanded(atMs: number | undefined, dropped: boolean, clocks: TheAudioClocks | null): void {
  const now = performance.now();
  const second = theSecondOf(now);
  if (second === null || atMs === undefined) {
    return;
  }
  second.handed += 1;
  const ahead = atMs - now;
  second.leastAheadMs = least(second.leastAheadMs, ahead);
  if (dropped) {
    second.dropped += 1;
  } else if (ahead < 0) {
    second.late += 1;
  }
  if (clocks !== null) {
    second.driftMs = clocks.driftMs;
    second.outputMs = clocks.outputMs;
    second.baseMs = clocks.baseMs;
  }
}

/** A beat acted on by the page - the marker moved, the keys lit - that was to be heard at a moment. */
export function noteABeatShown(heardAtMs: number): void {
  const now = performance.now();
  const second = theSecondOf(now);
  if (second === null) {
    return;
  }
  second.ticks += 1;
  second.latestTickMs = most(second.latestTickMs, now - heardAtMs);
}

/** A frame of the falling notes painted. */
export function noteAFrame(): void {
  const now = performance.now();
  const second = theSecondOf(now);
  if (second === null) {
    return;
  }
  second.frames += 1;
  if (lastFrameAt !== null) {
    second.longestFrameMs = most(second.longestFrameMs, now - lastFrameAt);
    if (now - lastFrameAt > FRAMES_STOOD_MS) {
      noteAnEvent(`the falling notes stood ${String(Math.round(now - lastFrameAt))} ms between two frames`);
    }
  }
  lastFrameAt = now;
}

/** The falling notes stopped, so the next frame's gap is not a stall. */
export function noteTheFramesStopped(): void {
  lastFrameAt = null;
}

function said(value: number | null, width: number, signed = false): string {
  if (value === null) {
    return '-'.padStart(width);
  }
  const whole = Math.round(value);
  return `${signed && whole > 0 ? '+' : ''}${String(whole)}`.padStart(width);
}

/** The timings as text to be read: what each column is, then a line a second. */
export function thePlaybackTimingsText(device: string): string {
  const lines = [
    'How the last playbacks kept time, the latest first',
    device,
    '',
    'sec    - seconds since the pulse started',
    'notes  - notes handed to the instrument',
    'ahead  - the least time a note was handed before it was to be heard (ms; below 0 is late)',
    'late   - notes handed after their moment, sounded late',
    'drop   - notes handed too late to be sounded at all',
    'drift  - how far the audio clock has moved from the page clock since the pulse started (ms; above 0, sounds later than placed)',
    'out    - output latency the browser reports (ms), base latency after the slash',
    'beats  - beats the page acted on (marker, keys)',
    'b.late - the latest a beat was acted on after it was heard (ms)',
    'frames - frames of falling notes painted; gap - the longest between two (ms)',
    'clock  - the earliest the audio clock\'s nought stood in the second, against the first look (ms; it rises while the audio clock stands)',
    'again  - how far the clocks\' reading was taken again in the second (ms)',
  ];
  [thisPlayback(), ...earlier].forEach((playback, at) => {
    lines.push('', `${PLAYBACKS_SAID[at] ?? 'An earlier one'}:`, ...playback);
  });
  return lines.join('\n');
}

/** What each playback kept is called, the latest first. */
const PLAYBACKS_SAID = ['The latest playback', 'The one before it', 'The one before that'];

/** The playback going, or the last: its seconds, a line each, and what happened in it. */
function thisPlayback(): string[] {
  const lines = ['  sec notes ahead late drop drift   out/base beats b.late frames   gap clock again'];
  for (const [at, second] of [...seconds].sort(([one], [other]) => one - other)) {
    lines.push(
      [
        said(at, 5),
        said(second.handed, 5),
        said(second.leastAheadMs, 5, true),
        said(second.late, 4),
        said(second.dropped, 4),
        said(second.driftMs, 5, true),
        `${said(second.outputMs, 6)}/${said(second.baseMs, 3)}`,
        said(second.ticks, 5),
        said(second.latestTickMs, 6),
        said(second.frames, 6),
        said(second.longestFrameMs, 5),
        said(second.earliestNoughtMs, 5, true),
        said(second.readAgainMs, 5, true),
      ].join(' '),
    );
  }
  if (seconds.size === 0) {
    lines.push('Nothing yet: start a playback, and copy this after it.');
  }
  if (events.length > 0) {
    lines.push('What happened, ms since the pulse started:');
    for (const { atMs, what } of events) {
      // Before the start is said so, however little before.
      lines.push(`${said(atMs < 0 ? Math.min(-1, Math.round(atMs)) : atMs, 7, true)}  ${what}`);
    }
  }
  return lines;
}
