// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { FocusMode, type FullscreenDocumentLike } from '../../src/ui/FocusMode.js';

/** Stands in for `document`, so fullscreen events can be fired on demand. */
class FakeDocument implements FullscreenDocumentLike {
  fullscreenElement: unknown = null;
  exitFullscreen = vi.fn(() => {
    this.fullscreenElement = null;
    return Promise.resolve();
  });

  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const bucket = this.listeners.get(type) ?? new Set<() => void>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      (listener as (value?: unknown) => void)(event);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

interface Rig {
  readonly root: HTMLElement;
  readonly doc: FakeDocument;
  readonly focus: FocusMode;
  readonly changes: boolean[];
  readonly requestFullscreen: ReturnType<typeof vi.fn>;
}

function createRig(options: { fullscreen?: 'ok' | 'rejects' | 'missing' } = {}): Rig {
  const behaviour = options.fullscreen ?? 'ok';
  const root = document.createElement('div');
  document.body.append(root);
  const doc = new FakeDocument();
  const changes: boolean[] = [];

  const requestFullscreen = vi.fn(() => {
    if (behaviour === 'rejects') {
      return Promise.reject(new Error('refused'));
    }
    doc.fullscreenElement = root;
    return Promise.resolve();
  });

  if (behaviour !== 'missing') {
    Object.assign(root, { requestFullscreen });
  }

  const focus = new FocusMode({
    root,
    doc,
    onChange: (active) => changes.push(active),
  });

  return { root, doc, focus, changes, requestFullscreen };
}

describe('FocusMode', () => {
  it('puts the page into focus layout and asks for real fullscreen', async () => {
    const rig = createRig();

    await rig.focus.enter();

    expect(rig.focus.isActive).toBe(true);
    expect(rig.root.classList.contains('is-focus')).toBe(true);
    expect(rig.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(rig.changes).toEqual([true]);
  });

  it('still gives the full page when the browser has no fullscreen API', async () => {
    const rig = createRig({ fullscreen: 'missing' });

    await rig.focus.enter();

    // The layout is the promise we can keep; browser chrome is a bonus.
    expect(rig.focus.isActive).toBe(true);
    expect(rig.root.classList.contains('is-focus')).toBe(true);
  });

  it('stays in focus layout when fullscreen is refused', async () => {
    const rig = createRig({ fullscreen: 'rejects' });

    await expect(rig.focus.enter()).resolves.toBeUndefined();

    expect(rig.focus.isActive).toBe(true);
    expect(rig.root.classList.contains('is-focus')).toBe(true);
  });

  it('leaves focus layout and real fullscreen together', async () => {
    const rig = createRig();
    await rig.focus.enter();

    await rig.focus.exit();

    expect(rig.focus.isActive).toBe(false);
    expect(rig.root.classList.contains('is-focus')).toBe(false);
    expect(rig.doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(rig.changes).toEqual([true, false]);
  });

  it('follows the browser out of fullscreen', async () => {
    const rig = createRig();
    await rig.focus.enter();

    // The reader pressed Escape, or swiped the system gesture.
    rig.doc.fullscreenElement = null;
    rig.doc.fire('fullscreenchange');

    expect(rig.focus.isActive).toBe(false);
    expect(rig.root.classList.contains('is-focus')).toBe(false);
  });

  it('ignores fullscreen changes it did not cause', async () => {
    const rig = createRig();
    await rig.focus.enter();

    rig.doc.fire('fullscreenchange');

    expect(rig.focus.isActive).toBe(true);
  });

  it('exits on Escape even without real fullscreen', async () => {
    const rig = createRig({ fullscreen: 'missing' });
    await rig.focus.enter();

    rig.doc.fire('keydown', { key: 'Escape' });

    expect(rig.focus.isActive).toBe(false);
  });

  it('leaves other keys alone', async () => {
    const rig = createRig();
    await rig.focus.enter();

    rig.doc.fire('keydown', { key: 'a' });

    expect(rig.focus.isActive).toBe(true);
  });

  it('toggles', async () => {
    const rig = createRig();

    await rig.focus.toggle();
    expect(rig.focus.isActive).toBe(true);

    await rig.focus.toggle();
    expect(rig.focus.isActive).toBe(false);
  });

  it('does nothing when asked to enter or exit twice', async () => {
    const rig = createRig();

    await rig.focus.enter();
    await rig.focus.enter();
    expect(rig.requestFullscreen).toHaveBeenCalledTimes(1);

    await rig.focus.exit();
    await rig.focus.exit();
    expect(rig.changes).toEqual([true, false]);
  });

  it('releases its listeners on dispose', () => {
    const rig = createRig();

    rig.focus.dispose();

    expect(rig.doc.listenerCount('fullscreenchange')).toBe(0);
    expect(rig.doc.listenerCount('webkitfullscreenchange')).toBe(0);
    expect(rig.doc.listenerCount('keydown')).toBe(0);
  });
});
