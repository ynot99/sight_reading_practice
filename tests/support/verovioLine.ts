import {
  replyTo,
  type EngraverAsk,
  type EngraverLine,
  type EngraverReply,
} from '../../src/infrastructure/rendering/verovio/engraverLine.js';
import type { VerovioCore } from '../../src/infrastructure/rendering/verovio/VerovioCore.js';

/**
 * A line whose far end is the engraver on this same thread, answering a turn
 * later as a worker would, so nothing can rely on an answer arriving at once.
 */
export function lineToThe(engraver: VerovioCore): EngraverLine & { readonly sent: EngraverAsk[] } {
  const replies: ((reply: EngraverReply) => void)[] = [];
  const sent: EngraverAsk[] = [];
  return {
    sent,
    send(ask) {
      sent.push(ask);
      setTimeout(() => {
        const reply = replyTo(engraver, ask);
        for (const listener of replies) {
          listener(reply);
        }
      }, 0);
    },
    onReply(listener) {
      replies.push(listener);
    },
    onBroken() {
      // This end never breaks.
    },
    close() {
      // Nothing to let go of on this thread.
    },
  };
}
