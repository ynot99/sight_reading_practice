import { describe, expect, it } from 'vitest';
import { CursorNavigator } from '../../src/infrastructure/rendering/CursorNavigator.js';
import { FakeCursorPrimitive } from '../../src/infrastructure/testing/FakeScoreRenderer.js';

describe('CursorNavigator', () => {
  it('steps forward one position at a time', () => {
    const primitive = new FakeCursorPrimitive(6);
    const navigator = new CursorNavigator(primitive);

    navigator.moveTo(1);
    navigator.moveTo(2);

    expect(navigator.position).toBe(2);
    expect(primitive.position).toBe(2);
    expect(primitive.nextCalls).toBe(2);
    expect(primitive.resetCalls).toBe(0);
  });

  it('jumps forward by several positions in one move', () => {
    const primitive = new FakeCursorPrimitive(10);
    const navigator = new CursorNavigator(primitive);

    navigator.moveTo(4);

    expect(navigator.position).toBe(4);
    expect(primitive.nextCalls).toBe(4);
  });

  it('rewinds by resetting and replaying', () => {
    const primitive = new FakeCursorPrimitive(10);
    const navigator = new CursorNavigator(primitive);
    navigator.moveTo(5);

    navigator.moveTo(2);

    expect(navigator.position).toBe(2);
    expect(primitive.resetCalls).toBe(1);
    expect(primitive.position).toBe(2);
  });

  it('treats a move to the current position as a no-op', () => {
    const primitive = new FakeCursorPrimitive(10);
    const navigator = new CursorNavigator(primitive);
    navigator.moveTo(3);
    const callsBefore = primitive.nextCalls;

    navigator.moveTo(3);

    expect(primitive.nextCalls).toBe(callsBefore);
    expect(primitive.resetCalls).toBe(0);
  });

  it('clamps negative targets to the start', () => {
    const primitive = new FakeCursorPrimitive(4);
    const navigator = new CursorNavigator(primitive);
    navigator.moveTo(2);

    navigator.moveTo(-3);

    expect(navigator.position).toBe(0);
  });

  it('stops at the end of the sheet instead of running away', () => {
    const primitive = new FakeCursorPrimitive(3);
    const navigator = new CursorNavigator(primitive);

    navigator.moveTo(99);

    expect(primitive.position).toBe(2);
    expect(navigator.position).toBeLessThanOrEqual(2);
    expect(primitive.nextCalls).toBeLessThanOrEqual(3);
  });

  it('forwards visibility and reset to the engraver', () => {
    const primitive = new FakeCursorPrimitive(4);
    const navigator = new CursorNavigator(primitive);

    navigator.show();
    expect(primitive.visible).toBe(true);
    navigator.hide();
    expect(primitive.visible).toBe(false);

    navigator.moveTo(2);
    navigator.reset();
    expect(navigator.position).toBe(0);
    expect(primitive.resetCalls).toBe(1);
  });
});
