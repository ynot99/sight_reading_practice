/** Thin, typed helpers over the DOM. Keeps `AppView` free of casts. */
export function requireElement<T extends HTMLElement>(
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
