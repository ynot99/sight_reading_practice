/** One thing to play: a stretch of bars, with one hand or both, at a speed. */
export interface DrillTask {
  /** Inclusive, in the bar numbers the reader sees. */
  readonly fromBar: number;
  readonly toBar: number;
  /** The staff to play, or `null` for the whole texture. */
  readonly hand: number | null;
  /** Of the written tempo, as a percentage. */
  readonly tempoPercent: number;
  /**
   * Which round of the plan this belongs to.
   *
   * `section` is one section learned by itself, hand by hand; `joined` is
   * sections glued together; `whole` is the piece in one go. Kept so the page
   * can say what is being asked without working it out from the bar numbers.
   */
  readonly stage: 'section' | 'joined' | 'whole';
}

export interface DrillPlanOptions {
  /** Bars in a section. His own word for it: a piece is split into stretches. */
  readonly sectionBars?: number;
  /** The staves the piece actually has, low to high; `[]` for one voice. */
  readonly hands?: readonly number[];
  /** How slow a section is taken while it is being learned. */
  readonly sectionPercent?: number;
  /** And once two of them are glued together. */
  readonly joinedPercent?: number;
  /** And for the whole piece at the end. */
  readonly wholePercent?: number;
}

const DEFAULTS = {
  sectionBars: 4,
  sectionPercent: 70,
  joinedPercent: 85,
  wholePercent: 100,
} as const;

/**
 * How well a task has to go before the plan moves on.
 *
 * "Until it is learned perfectly", in his words, and a reading that stopped
 * halfway is not a reading of it at all - so both halves are asked: the run
 * reached the end, and what it scored was clean.
 */
export const DRILL_PASS_MARK = 0.95;

/**
 * The order Piano Marvel teaches a piece in, written out.
 *
 * His line 93: a piece is split into sections; each section is played slowly
 * with the left hand, then the right, then both; then the next section the
 * same way; then two sections are glued together, and so on until the whole
 * thing holds.
 *
 * A list rather than a machine that decides as it goes. Everything the drill
 * needs to know about a piece - how many bars, which staves - is known before
 * a note is played, so the whole plan can be built at the start and read off
 * afterwards. What the reader does only decides *where in it* they are.
 */
export function planTheDrill(bars: number, options: DrillPlanOptions = {}): readonly DrillTask[] {
  const sectionBars = Math.max(1, Math.round(options.sectionBars ?? DEFAULTS.sectionBars));
  const sectionPercent = options.sectionPercent ?? DEFAULTS.sectionPercent;
  const joinedPercent = options.joinedPercent ?? DEFAULTS.joinedPercent;
  const wholePercent = options.wholePercent ?? DEFAULTS.wholePercent;
  const hands = options.hands ?? [];
  if (bars <= 0) {
    return [];
  }

  const tasks: DrillTask[] = [];
  // Hands first and then both, low to high, which is the order he wrote and
  // the order a teacher asks for: the left hand is usually the accompaniment
  // and the ground the rest is heard against.
  const passes: readonly (number | null)[] = hands.length > 1 ? [...hands, null] : [null];

  for (let from = 1; from <= bars; from += sectionBars) {
    const to = Math.min(bars, from + sectionBars - 1);
    for (const hand of passes) {
      tasks.push({ fromBar: from, toBar: to, hand, tempoPercent: sectionPercent, stage: 'section' });
    }
  }

  // Then glued, doubling: two sections, then four, and so on. Each round
  // stops short of the whole piece, which is the last task on its own.
  for (let span = sectionBars * 2; span < bars; span *= 2) {
    for (let from = 1; from <= bars; from += span) {
      const to = Math.min(bars, from + span - 1);
      // A tail shorter than a section has already been played exactly as it
      // stands, in the round before this one.
      if (to - from + 1 <= span / 2) {
        continue;
      }
      tasks.push({ fromBar: from, toBar: to, hand: null, tempoPercent: joinedPercent, stage: 'joined' });
    }
  }

  if (bars > sectionBars) {
    tasks.push({ fromBar: 1, toBar: bars, hand: null, tempoPercent: wholePercent, stage: 'whole' });
  }
  return tasks;
}

/** Whether a reading was good enough to move the plan on. */
export function drillTaskPassed(
  report: { readonly completed: boolean; readonly overall: number } | null,
  passMark = DRILL_PASS_MARK,
): boolean {
  return report !== null && report.completed && report.overall >= passMark;
}
