import { describe, expect, it } from 'vitest';
import { CursorNavigator } from '../../src/infrastructure/rendering/CursorNavigator.js';
import { FakeCursorPrimitive } from '../../src/infrastructure/testing/FakeScoreRenderer.js';

describe('CursorNavigator', () => {
  it('puts the marker down once for a walk, not at every step on the way', () => {
    // A walk has one interesting position: the last. An engraver's `next` puts
    // the marker on the page at every one of them, each a read of the layout
    // and a write to the drawing - so starting a run eight hundred bars into a
    // long score dragged the marker through eight thousand positions first. His:
    // "просунувся до 800 бару - та там затримка ще більше відчувається, бо
    // стрибає ще далі".
    const primitive = new FakeCursorPrimitive(2_000);
    const navigator = new CursorNavigator(primitive);

    navigator.moveTo(1_500);

    expect(primitive.nextCalls).toBe(1_500);
    expect(primitive.drawn).toBe(1);
  });

  it('still draws where a single step lands', () => {
    // Which is every step of a run: one walked position is still a position
    // the reader has to see the marker at.
    const primitive = new FakeCursorPrimitive(100);
    const navigator = new CursorNavigator(primitive);

    navigator.moveTo(1);

    expect(primitive.drawn).toBe(1);
  });

  it('draws nothing where there was nowhere to walk', () => {
    const primitive = new FakeCursorPrimitive(100);
    const navigator = new CursorNavigator(primitive);

    navigator.moveTo(0);

    expect(primitive.drawn).toBe(0);
  });

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

  it('goes back a step at a time when that is the shorter way', () => {
    // What a passage does: the last run finished at its end, the next begins at
    // its start, and the two are a few bars apart in a piece of hundreds of
    // positions. Rewinding to the top and replaying moved the marker across the
    // whole engraving to get back a few bars, in front of the sound the
    // reader's chord had just asked for.
    const primitive = new FakeCursorPrimitive(600);
    const navigator = new CursorNavigator(primitive);
    navigator.moveTo(520);
    primitive.nextCalls = 0;

    navigator.moveTo(480);

    expect(navigator.position).toBe(480);
    expect(primitive.position).toBe(480);
    expect(primitive.backCalls).toBe(40);
    expect(primitive.resetCalls).toBe(0);
    expect(primitive.nextCalls).toBe(0);
  });

  it('puts the marker down once for a walk back as well', () => {
    // The start of a passage after the last run finished at its end: a few
    // bars back, and each of them drawn was a fresh picture of the marker that
    // nobody saw.
    const primitive = new FakeCursorPrimitive(600);
    const navigator = new CursorNavigator(primitive);
    navigator.moveTo(520);
    primitive.drawn = 0;

    navigator.moveTo(480);

    expect(primitive.drawn).toBe(1);
  });

  it('still rewinds when the beginning is the nearer end', () => {
    // Going back is not always the shorter way: a jump from bar three to bar
    // one is two moves backwards or one reset and one step forward.
    const primitive = new FakeCursorPrimitive(600);
    const navigator = new CursorNavigator(primitive);
    navigator.moveTo(500);
    primitive.nextCalls = 0;

    navigator.moveTo(3);

    expect(navigator.position).toBe(3);
    expect(primitive.position).toBe(3);
    expect(primitive.resetCalls).toBe(1);
    expect(primitive.nextCalls).toBe(3);
    expect(primitive.backCalls).toBe(0);
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
