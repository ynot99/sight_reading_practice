import { assertNever } from '../../../shared/asserts.js';
import type { PageShape, VerovioCore } from './VerovioCore.js';

/**
 * What the page asks of the engraver running apart from it.
 *
 * Plain data, because it crosses from one thread to the other by being
 * copied: a score is handed over as its text, and a page comes back as its SVG.
 */
export type EngraverQuestion =
  | { readonly type: 'load'; readonly musicXml: string; readonly shape: PageShape }
  | { readonly type: 'page'; readonly page: number }
  | { readonly type: 'relayout'; readonly shape: PageShape }
  | { readonly type: 'pageOf'; readonly elementId: string };

/** What each question is answered with. */
export interface EngraverAnswers {
  readonly load: number;
  readonly page: string;
  readonly relayout: number;
  readonly pageOf: number | null;
}

export interface EngraverAsk {
  readonly id: number;
  readonly question: EngraverQuestion;
}

/** An answer to the ask with the same `id`, or why there is none. */
export type EngraverReply =
  | { readonly id: number; readonly ok: true; readonly value: EngraverAnswers[keyof EngraverAnswers] }
  | { readonly id: number; readonly ok: false; readonly error: string };

/**
 * Both ends of a line to the engraver, whichever side of a thread it runs on.
 *
 * The page holds one end; the worker - or, in a test, the engraver itself -
 * answers at the other.
 */
export interface EngraverLine {
  send(ask: EngraverAsk): void;
  onReply(listener: (reply: EngraverReply) => void): void;
  /** The far end is gone - the worker failed to start, or died - and nothing more will come. */
  onBroken(listener: (reason: string) => void): void;
  /** Lets the far end go: the page that asked is being thrown away. */
  close(): void;
}

/** Answers one question, on the engraver's side of the line. */
export function answerFor(
  core: VerovioCore,
  question: EngraverQuestion,
): EngraverAnswers[keyof EngraverAnswers] {
  switch (question.type) {
    case 'load':
      return core.load(question.musicXml, question.shape);
    case 'page':
      return core.page(question.page);
    case 'relayout':
      return core.relayout(question.shape);
    case 'pageOf':
      return core.pageOf(question.elementId);
    default:
      return assertNever(question, 'Unknown question for the engraver');
  }
}

/** The answer to an ask, or its failure put into words, on the engraver's side. */
export function replyTo(core: VerovioCore, ask: EngraverAsk): EngraverReply {
  try {
    return { id: ask.id, ok: true, value: answerFor(core, ask.question) };
  } catch (error) {
    return { id: ask.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
