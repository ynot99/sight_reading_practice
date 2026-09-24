import type { OverlayShape } from './playedNoteShapes.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * One shape of a played note, as an element of the page it is drawn on.
 *
 * In the drawing's own units, whatever they are: the shapes were worked out
 * in them, and the stylesheet keeps the strokes the same width on the screen
 * at any scale. Its colour is said as a class - what the press was judged -
 * and the stylesheet says what colour that is.
 */
export function drawShape(shape: OverlayShape, doc: Document): SVGElement {
  const colourClass = shape.sounding
    ? 'played--sounding'
    : !shape.correct
      ? 'played--wrong'
      : shape.looseTiming
        ? 'played--loose'
        : 'played--correct';
  switch (shape.kind) {
    case 'notehead': {
      const element = doc.createElementNS(SVG_NAMESPACE, 'ellipse');
      element.setAttribute('cx', String(shape.x));
      element.setAttribute('cy', String(shape.y));
      element.setAttribute('rx', String(shape.radiusX));
      element.setAttribute('ry', String(shape.radiusY));
      element.setAttribute('class', `played-note ${colourClass}`);
      return element;
    }
    case 'ledger': {
      const element = doc.createElementNS(SVG_NAMESPACE, 'line');
      element.setAttribute('x1', String(shape.x1));
      element.setAttribute('x2', String(shape.x2));
      element.setAttribute('y1', String(shape.y));
      element.setAttribute('y2', String(shape.y));
      element.setAttribute('class', `played-ledger ${colourClass}`);
      return element;
    }
    case 'accidental': {
      const element = doc.createElementNS(SVG_NAMESPACE, 'text');
      element.setAttribute('x', String(shape.x));
      element.setAttribute('y', String(shape.y));
      element.setAttribute('font-size', String(shape.size));
      element.setAttribute('text-anchor', 'middle');
      element.setAttribute('class', `played-accidental ${colourClass}`);
      element.textContent = shape.text;
      return element;
    }
    default:
      return doc.createElementNS(SVG_NAMESPACE, 'g');
  }
}
