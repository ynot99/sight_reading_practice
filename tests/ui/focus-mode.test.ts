// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { FocusMode, type FullscreenDocumentLike } from '../../src/ui/FocusMode.js';

/** Stands in for `document`, so key events can be fired on demand. */
class FakeDocument implements FullscreenDocumentLike {
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

function createRig(): Rig {
  const root = document.createElement('div');
  document.body.append(root);
  const doc = new FakeDocument();
  const changes: boolean[] = [];
  const requestFullscreen = vi.fn(() => Promise.resolve());
  Object.assign(root, { requestFullscreen });

  const focus = new FocusMode({
    root,
    doc,
    onChange: (active) => changes.push(active),
  });

  return { root, doc, focus, changes, requestFullscreen };
}

describe('FocusMode', () => {
  it('puts the page into focus layout', () => {
    const rig = createRig();

    rig.focus.enter();

    expect(rig.focus.isActive).toBe(true);
    expect(rig.root.classList.contains('is-focus')).toBe(true);
    expect(rig.changes).toEqual([true]);
  });

  it('never asks the browser for its own fullscreen', () => {
    // It cannot be kept. The device's fullscreen brings a swipe-down and a
    // floating close button that no page can turn off, and it leaves the
    // moment an on-screen keyboard opens - which is what tapping a bar number
    // does. Every one of those dropped the reader out of the layout while
    // they were playing.
    const rig = createRig();

    rig.focus.enter();
    rig.focus.exit();

    expect(rig.requestFullscreen).not.toHaveBeenCalled();
  });

  it('leaves focus layout when asked', () => {
    const rig = createRig();
    rig.focus.enter();

    rig.focus.exit();

    expect(rig.focus.isActive).toBe(false);
    expect(rig.root.classList.contains('is-focus')).toBe(false);
    expect(rig.changes).toEqual([true, false]);
  });

  it('exits on Escape', () => {
    const rig = createRig();
    rig.focus.enter();

    rig.doc.fire('keydown', { key: 'Escape' });

    expect(rig.focus.isActive).toBe(false);
  });

  it('leaves other keys alone', () => {
    const rig = createRig();
    rig.focus.enter();

    rig.doc.fire('keydown', { key: 'a' });

    expect(rig.focus.isActive).toBe(true);
  });

  it('toggles', () => {
    const rig = createRig();

    rig.focus.toggle();
    expect(rig.focus.isActive).toBe(true);

    rig.focus.toggle();
    expect(rig.focus.isActive).toBe(false);
  });

  it('does nothing when asked to enter or exit twice', () => {
    const rig = createRig();

    rig.focus.enter();
    rig.focus.enter();
    rig.focus.exit();
    rig.focus.exit();

    expect(rig.changes).toEqual([true, false]);
  });

  it('releases its listeners on dispose', () => {
    const rig = createRig();

    rig.focus.dispose();

    expect(rig.doc.listenerCount('keydown')).toBe(0);
  });
});
