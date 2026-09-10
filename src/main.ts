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

/**
 * Keeps the application on the tablet once it has been there.
 *
 * His: it should open without the internet. It is practised on an iPad from a
 * Home Screen icon, and a page that needs a network to draw its own buttons
 * cannot be practised on a train or with the router off.
 *
 * Only in a built copy. A worker in front of the dev server would answer with
 * yesterday's module every time something was edited, which is a debugging
 * session nobody wins.
 */
function keepItOnTheDevice(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }
  // Relative to the document, so it works both at the site root and under the
  // project path on GitHub Pages - the same reasoning the samples follow.
  const url = new URL('service-worker.js', document.baseURI).href;
  void navigator.serviceWorker.register(url).catch((error: unknown) => {
    // eslint-disable-next-line no-console -- the app works without it.
    console.error('Could not keep the trainer on this device', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
keepItOnTheDevice();
