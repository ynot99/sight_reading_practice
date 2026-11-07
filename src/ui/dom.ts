/** Thin, typed helpers over the DOM. Keeps `AppView` free of casts. */
/**
 * `Element`, not `HTMLElement`: the transport's icons are SVG paths, and a
 * constraint that excluded them would send the view back to `querySelector`
 * and lose the "missing id fails loudly" that this exists for.
 */
export function requireElement<T extends Element>(
  root: Document | HTMLElement,
  id: string,
): T {
  const element = root instanceof Document ? root.getElementById(id) : root.querySelector(`#${id}`);
  if (element === null) {
    throw new Error(`Missing required element #${id}.`);
  }
  return element as T;
}

export function option(value: string, label: string, selected = false): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  element.selected = selected;
  return element;
}

export function fillSelect(
  select: HTMLSelectElement,
  items: readonly { value: string; label: string }[],
  selectedValue: string,
): void {
  select.replaceChildren(
    ...items.map((item) => option(item.value, item.label, item.value === selectedValue)),
  );
}

/** Anything the space bar already means something to. */
export function isFormControl(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  const tag = element.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    tag === 'BUTTON' ||
    element.hasAttribute('contenteditable')
  );
}

/**
 * Whether a control holding the focus has a use of its own for the arrow
 * keys: a list, a slider, a choice of one, anything typed into. A button has
 * none, so the arrows are the editor's still while one holds the focus -
 * as a chord of the drawer does once it is pressed, and Shift and the
 * arrows were then lost to the notes it had just written.
 */
export function usesTheArrows(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  const type = element.tagName === 'INPUT' ? (element.getAttribute('type') ?? 'text') : null;
  return isFormControl(element) && element.tagName !== 'BUTTON' && !['button', 'checkbox', 'submit', 'reset'].includes(type ?? '');
}
