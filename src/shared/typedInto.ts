/**
 * As much of where a key went as this needs to know.
 *
 * Shaped rather than taken as an `Element`: nothing here touches the
 * document, and a test can hand it a plain object. Asked by the keys that play
 * notes and by the keys that edit, which must stand aside for the same boxes.
 */
export interface TypedInto {
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

/**
 * Inputs that letters do nothing in.
 *
 * The list is of what to *let through*, not of what to catch, and that way
 * round on purpose: an input type nobody thought of here is treated as one that
 * takes text, so an unknown box swallows a note rather than a name.
 */
const NOT_TYPED_IN = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
]);

/**
 * Whether a key was typed into something that takes text.
 *
 * Narrower than the question the space bar asks, and deliberately. That one
 * counts a focused button, because space presses buttons; this one must not, or
 * the keyboard would go dead the moment the reader pressed Start with a mouse
 * and left the focus sitting on it. Same for a checkbox: it keeps the focus
 * after a tick, and letters mean nothing to it.
 */
export function isTypedInto(target: TypedInto | null | undefined): boolean {
  if (target === null || target === undefined) {
    return false;
  }
  if (target.isContentEditable === true) {
    return true;
  }
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (tag !== 'INPUT') {
    return false;
  }
  return !NOT_TYPED_IN.has((target.type ?? 'text').toLowerCase());
}
