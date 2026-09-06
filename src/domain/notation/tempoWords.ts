import type { Exercise, TempoChange, TempoWord } from '../model/Exercise.js';
import { barLines } from '../model/Exercise.js';

/**
 * How finely a gradual change is written out.
 *
 * One step per beat. The clock this program keeps is a list of constant
 * tempos - which is what makes a tempo change a thing the metronome, the
 * timeline and the judging all agree about - so a gradual change has to be
 * said in that language. A beat is fine enough that nobody hears the steps
 * and coarse enough that a page of `rit.` is a handful of numbers.
 */
const STEPS_PER_BEAT = 1;

/** Where a word sits, in ticks from the beginning of the piece. */
function atTicks(exercise: Exercise, measureIndex: number, offsetTicks: number): number {
  const bars = barLines(exercise);
  return (bars[measureIndex]?.startTicks ?? 0) + offsetTicks;
}

/** The tempo in force at a moment, reading only the marks written as numbers. */
function tempoAt(exercise: Exercise, ticks: number): number {
  let bpm = exercise.tempoBpm;
  for (const change of exercise.tempoChanges) {
    if (atTicks(exercise, change.measureIndex, change.offsetTicks) <= ticks) {
      bpm = change.tempoBpm;
    }
  }
  return bpm;
}

/**
 * The moments a gradual change can be heading for, in order.
 *
 * A written tempo, or the word `a tempo` - which is a target like any other,
 * being an instruction to go back to the speed the piece was last told to
 * play at.
 */
function anchorsOf(exercise: Exercise): readonly { ticks: number; bpm: number }[] {
  const anchors = exercise.tempoChanges.map((change) => ({
    ticks: atTicks(exercise, change.measureIndex, change.offsetTicks),
    bpm: change.tempoBpm,
  }));
  for (const word of exercise.tempoWords) {
    if (word.kind !== 'a-tempo') {
      continue;
    }
    const ticks = atTicks(exercise, word.measureIndex, word.offsetTicks);
    // The speed it was last *told* to play at, which is the last number
    // written before this - not the speed the accelerando had reached.
    anchors.push({ ticks, bpm: tempoAt(exercise, ticks - 1) });
  }
  return anchors.sort((left, right) => left.ticks - right.ticks);
}

/**
 * A piece with its written words turned into changes of speed.
 *
 * `accel.` and `rit.` say to move, and say nothing about how far: the
 * distance is the next thing that names a speed - a metronome mark, or `a
 * tempo`. Where nothing follows to move *to*, the word is drawn on the page
 * and does nothing, which is the honest reading of an instruction with no
 * destination.
 *
 * Written out as a run of ordinary tempo changes rather than as a new kind of
 * thing, so that everything downstream - the metronome's plan, the timeline's
 * milliseconds, the judging window - goes on working with what it already
 * understands. A gradual change is many small constant ones, and this is the
 * only place that has to know it.
 */
export function withTempoWordsPlayed(exercise: Exercise): Exercise {
  const gradual = exercise.tempoWords.filter(
    (word) => word.kind === 'accelerando' || word.kind === 'ritardando',
  );
  const aTempo = exercise.tempoWords.filter((word) => word.kind === 'a-tempo');
  if (gradual.length === 0 && aTempo.length === 0) {
    return exercise;
  }

  const bars = barLines(exercise);
  const anchors = anchorsOf(exercise);
  const added: TempoChange[] = [];

  // `a tempo` is a change in its own right: the speed goes back at once.
  for (const word of aTempo) {
    const ticks = atTicks(exercise, word.measureIndex, word.offsetTicks);
    const already = exercise.tempoChanges.some(
      (change) => atTicks(exercise, change.measureIndex, change.offsetTicks) === ticks,
    );
    if (already) {
      // The file already says a number here, and it is the writer's own.
      continue;
    }
    added.push({
      measureIndex: word.measureIndex,
      offsetTicks: word.offsetTicks,
      tempoBpm: tempoAt(exercise, ticks - 1),
      implied: true,
    });
  }

  for (const word of gradual) {
    const from = atTicks(exercise, word.measureIndex, word.offsetTicks);
    const target = anchors.find((anchor) => anchor.ticks > from);
    if (target === undefined) {
      // Nothing to move to, so nothing to do: the word is printed and the
      // clock is left alone rather than guessed at.
      continue;
    }
    const startBpm = tempoAt(exercise, from);
    if (target.bpm === startBpm || target.ticks <= from) {
      continue;
    }
    const pulse = bars[word.measureIndex]?.timeSignature.ticksPerPulse ?? 0;
    const step = pulse > 0 ? Math.round(pulse / STEPS_PER_BEAT) : 0;
    if (step <= 0) {
      continue;
    }
    // Every beat between the word and its destination, moving evenly. The
    // destination itself is left to the mark that names it - two changes at
    // one moment would be one of them saying nothing.
    for (let at = from + step; at < target.ticks; at += step) {
      const howFar = (at - from) / (target.ticks - from);
      const bpm = Math.round(startBpm + (target.bpm - startBpm) * howFar);
      const barIndex = bars.findIndex(
        (bar) => at >= bar.startTicks && at < bar.startTicks + bar.timeSignature.ticksPerMeasure,
      );
      if (barIndex < 0) {
        continue;
      }
      added.push({
        measureIndex: barIndex,
        offsetTicks: at - (bars[barIndex]?.startTicks ?? 0),
        tempoBpm: bpm,
        implied: true,
      });
    }
  }

  if (added.length === 0) {
    return exercise;
  }
  const all = [...exercise.tempoChanges, ...added].sort(
    (left, right) =>
      atTicks(exercise, left.measureIndex, left.offsetTicks) -
      atTicks(exercise, right.measureIndex, right.offsetTicks),
  );
  return { ...exercise, tempoChanges: all };
}

/** What a word written in a score means for the clock, if anything. */
export function tempoWordKind(text: string): TempoWord['kind'] {
  const said = text.toLowerCase().replace(/[.\s]+/g, ' ').trim();
  if (said.startsWith('a tempo') || said.startsWith('tempo primo') || said.startsWith('tempo i')) {
    return 'a-tempo';
  }
  if (said.startsWith('accel') || said.startsWith('string') || said.startsWith('più mosso')) {
    return 'accelerando';
  }
  if (
    said.startsWith('rit') ||
    said.startsWith('rall') ||
    said.startsWith('allarg') ||
    said.startsWith('meno mosso')
  ) {
    return 'ritardando';
  }
  return 'other';
}
