import type { EngraverAsk, EngraverLine, EngraverReply } from './engraverLine.js';

/**
 * A line to the engraver running in a worker of its own.
 *
 * The one place a worker is started. Written as `new Worker(new URL(...))`
 * because that is the form the bundler recognises and builds the worker - and
 * the 7 MB engraver inside it - as a file of its own.
 */
export function engraverInAWorker(): EngraverLine {
  const worker = new Worker(new URL('./engraver.worker.ts', import.meta.url), { type: 'module' });
  return {
    send(ask: EngraverAsk): void {
      worker.postMessage(ask);
    },
    onReply(listener: (reply: EngraverReply) => void): void {
      worker.addEventListener('message', (event: MessageEvent<EngraverReply>) => {
        listener(event.data);
      });
    },
    onBroken(listener: (reason: string) => void): void {
      worker.addEventListener('error', (event: ErrorEvent) => {
        listener(event.message);
      });
    },
    close(): void {
      // The score it held is a quarter of a gigabyte on the longest piece;
      // a worker is not collected while it runs.
      worker.terminate();
    },
  };
}
