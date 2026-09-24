/**
 * The engraver's own thread.
 *
 * Laying out the Alkan takes 12.9 s on the iPad and a zoom that reflows it six
 * to nine more; on the page's thread every second of that is a page that
 * neither draws nor answers a finger. Here the page only asks, and goes on
 * drawing frames while Verovio works (`worker.html`, docs/verovio.md on the
 * `verovio` branch).
 *
 * Nothing but the pump: the answers are `replyTo`, which the tests call on the
 * same thread. Asks are answered in the order they came, each after the
 * engraver has started, because every one of them waits on the same start.
 */
import { replyTo, type EngraverAsk } from './engraverLine.js';
import { VerovioCore } from './VerovioCore.js';

/** The little of a worker's global scope this uses, typed without the worker's library. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<EngraverAsk>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
const started = VerovioCore.start();

scope.onmessage = (event) => {
  const ask = event.data;
  void started.then(
    (core) => {
      scope.postMessage(replyTo(core, ask));
    },
    (error: unknown) => {
      scope.postMessage({
        id: ask.id,
        ok: false,
        error: `Verovio did not start. ${error instanceof Error ? error.message : String(error)}`,
      });
    },
  );
};
