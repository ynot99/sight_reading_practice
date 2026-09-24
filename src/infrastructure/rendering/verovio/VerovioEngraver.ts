import type {
  EngraverAnswers,
  EngraverLine,
  EngraverMessage,
  EngraverQuestion,
} from './engraverLine.js';
import type { PageShape } from './VerovioCore.js';

interface Waiting {
  readonly resolve: (value: EngraverAnswers[keyof EngraverAnswers]) => void;
  readonly reject: (error: Error) => void;
}

/**
 * The engraver as the page sees it: every question a promise of its answer.
 *
 * The engraver runs on the other end of a line - a worker, in the app - and
 * answers in the order it was asked. Each answer finds its way back to the one
 * who asked by the number the ask went out with, so any number of questions
 * can be waiting at once.
 */
export class VerovioEngraver {
  private readonly line: EngraverLine;
  private readonly waiting = new Map<number, Waiting>();
  private nextId = 1;
  /** Why the line went dead, once it has; every ask after it fails with this. */
  private broken: string | null = null;
  private roomListeners: ((heapBytes: number) => void)[] = [];

  constructor(line: EngraverLine) {
    this.line = line;
    line.onReply((message) => {
      this.settle(message);
    });
    line.onBroken((reason) => {
      this.breakDown(reason);
    });
  }

  /** Reads a score and lays it out; resolves to the number of pages. */
  load(musicXml: string, shape: PageShape): Promise<number> {
    return this.ask<'load'>({ type: 'load', musicXml, shape });
  }

  /** One page of the score laid out last, as SVG. Pages count from one. */
  page(page: number): Promise<string> {
    return this.ask<'page'>({ type: 'page', page });
  }

  /** The same score on another page; resolves to the number of pages. */
  relayout(shape: PageShape): Promise<number> {
    return this.ask<'relayout'>({ type: 'relayout', shape });
  }

  /** The page an element is drawn on, by the name it was printed with. */
  pageOf(elementId: string): Promise<number | null> {
    return this.ask<'pageOf'>({ type: 'pageOf', elementId });
  }

  /**
   * Hears how large the engraver's heap is once it has made room for a score
   * it is about to read - said before the reading, which is the long part.
   */
  onRoomMade(listener: (heapBytes: number) => void): () => void {
    this.roomListeners.push(listener);
    return () => {
      this.roomListeners = this.roomListeners.filter((each) => each !== listener);
    };
  }

  /** Lets the engraver go; everything waiting, and anything asked after, fails. */
  dispose(): void {
    this.breakDown('It was let go.');
    this.line.close();
  }

  private ask<K extends EngraverQuestion['type']>(
    question: Extract<EngraverQuestion, { readonly type: K }>,
  ): Promise<EngraverAnswers[K]> {
    if (this.broken !== null) {
      return Promise.reject(new Error(this.broken));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<EngraverAnswers[K]>((resolve, reject) => {
      // What comes back is whatever the other thread sent, which no type
      // follows across; `answerFor` on that side is what makes it this.
      this.waiting.set(id, {
        resolve: (value) => {
          resolve(value as EngraverAnswers[K]);
        },
        reject,
      });
      this.line.send({ id, question });
    });
  }

  private settle(reply: EngraverMessage): void {
    if ('roomMadeBytes' in reply) {
      for (const listener of [...this.roomListeners]) {
        listener(reply.roomMadeBytes);
      }
      return;
    }
    const waiting = this.waiting.get(reply.id);
    if (waiting === undefined) {
      return;
    }
    this.waiting.delete(reply.id);
    if (reply.ok) {
      waiting.resolve(reply.value);
      return;
    }
    waiting.reject(new Error(reply.error));
  }

  private breakDown(reason: string): void {
    this.broken = `The engraver is not there. ${reason}`.trim();
    for (const waiting of this.waiting.values()) {
      waiting.reject(new Error(this.broken));
    }
    this.waiting.clear();
  }
}
