import './styles.css';
import { createApp } from './composition/createApp.js';
import type { KeyboardTarget } from './infrastructure/midi/ComputerKeyboardMidiSource.js';
import { AppView } from './ui/AppView.js';

/**
 * Application entry point.
 *
 * Builds the object graph, hands it to the view and gets out of the way.
 */
function bootstrap(): void {
  // The engraver measures its container with offsetWidth, which counts
  // padding and border, so it gets an element that has neither.
  const scoreContainer = document.getElementById('score-surface');
  if (scoreContainer === null) {
    throw new Error('Missing #score-surface container.');
  }

  const runtime = createApp({
    scoreContainer,
    // The DOM's overloaded listener signature is wider than the port needs.
    keyboardTarget: document as unknown as KeyboardTarget,
    location: window.location,
    // Relative to the document, so it works both at the site root and under
    // the project path on GitHub Pages.
    sampleBaseUrl: new URL('samples/piano/', document.baseURI).href,
  });

  const view = new AppView(runtime, document);
  window.addEventListener('beforeunload', () => {
    view.dispose();
    runtime.dispose();
  });

  void view.initialize().catch((error: unknown) => {
    // eslint-disable-next-line no-console -- last-resort surface for boot failures.
    console.error('Failed to start the trainer', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
