import type { NamingQuestion } from '../../domain/model/Exercise.js';

/** A question of a naming round as it was answered: what was picked for each part, and whether all were right. */
export interface QuestionNamed {
  readonly question: NamingQuestion;
  readonly picked: readonly string[];
  readonly right: boolean;
}

/**
 * A round of questions to be named, answered one at a time: each part of
 * the question asked picked from its choices, and the question judged once
 * every part has been - right only where every part is. A question answered
 * stays as it was answered, to be shown, until the round is moved on to the
 * next; there is no answering it twice.
 */
export class NamingRound {
  readonly questions: readonly NamingQuestion[];
  private at = 0;
  private picked: (string | null)[];
  private readonly named: QuestionNamed[] = [];

  constructor(questions: readonly NamingQuestion[]) {
    this.questions = questions;
    this.picked = this.nothingPicked();
  }

  /** The question being asked, or answered and not yet moved on from; `null` once the round is over. */
  get asking(): NamingQuestion | null {
    return this.questions[this.at] ?? null;
  }

  /** Where in the round it is: the question's place, from nought. */
  get place(): number {
    return this.at;
  }

  /** What is picked so far for each part of the question asked, `null` for a part not yet answered. */
  get pickedSoFar(): readonly (string | null)[] {
    return this.picked;
  }

  /** How the question asked was answered, once every part has been; `null` before. */
  get answered(): QuestionNamed | null {
    const last = this.named.at(-1);
    return last !== undefined && last.question === this.asking ? last : null;
  }

  /** Every question answered so far, in order. */
  get answers(): readonly QuestionNamed[] {
    return this.named;
  }

  /** Whether every question has been answered and moved on from. */
  get over(): boolean {
    return this.asking === null;
  }

  /**
   * Picks an answer for a part of the question asked: one of its choices,
   * and only while the question is still open. Picked for its last part
   * unanswered, the question is judged. Whether anything was picked.
   */
  pick(part: number, choice: string): boolean {
    const question = this.asking;
    if (question === null || this.answered !== null || question.parts[part]?.choices.includes(choice) !== true) {
      return false;
    }
    this.picked = this.picked.map((was, at) => (at === part ? choice : was));
    const picked = this.picked.filter((each): each is string => each !== null);
    if (picked.length === question.parts.length) {
      this.named.push({ question, picked, right: question.parts.every((each, at) => each.answer === picked[at]) });
    }
    return true;
  }

  /** Moves on from a question answered to the next. Whether it moved. */
  next(): boolean {
    if (this.answered === null) {
      return false;
    }
    this.at += 1;
    this.picked = this.nothingPicked();
    return true;
  }

  /** How many questions were answered right, of how many answered. */
  get score(): { readonly right: number; readonly of: number } {
    return { right: this.named.filter((each) => each.right).length, of: this.named.length };
  }

  private nothingPicked(): (string | null)[] {
    return (this.questions[this.at]?.parts ?? []).map(() => null);
  }
}
