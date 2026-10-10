// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import type { XmlNode } from '../../src/domain/notation/XmlNode.js';
import { readXml } from '../../src/domain/notation/XmlReader.js';
import {
  arpeggiatedExercise,
  beamedSixteenths,
  compoundBarExercise,
  longExercise,
  staccatoInTheBass,
  tiedExercise,
  twoBarExercise,
} from '../support/fixtures.js';

/**
 * What the browser's parser makes of a document, copied into the same tree:
 * the reader stands in for it, so it is held to the same answers.
 */
function asTheBrowserReadsIt(document: string): XmlNode {
  const parsed = new DOMParser().parseFromString(document, 'application/xml');
  expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
  const copy = (element: Element): XmlNode => {
    const attributes: Record<string, string> = {};
    for (const attribute of element.attributes) {
      attributes[attribute.name] = attribute.value;
    }
    const children: XmlNode[] = [];
    let text = '';
    for (let node = element.firstChild; node !== null; node = node.nextSibling) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        children.push(copy(node as Element));
      } else if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        text += node.nodeValue ?? '';
      }
    }
    return { name: element.nodeName, attributes, children, text };
  };
  return copy(parsed.documentElement);
}

const NOT_XML = /not valid XML/;

describe('reading XML into the tree a score is read from', () => {
  it('reads a score as the browser does', () => {
    const serializer = new MusicXmlSerializer();
    const scores = [
      twoBarExercise({ title: 'Ça & <ça> "quoted"' }),
      longExercise({ bars: 8 }),
      arpeggiatedExercise(),
      beamedSixteenths(),
      compoundBarExercise(),
      tiedExercise(),
      staccatoInTheBass(),
    ];
    for (const score of scores) {
      const document = serializer.serialize(score);
      expect(readXml(document)).toEqual(asTheBrowserReadsIt(document));
    }
  });

  it('reads what XML allows a score to be written with, as the browser does', () => {
    const document = [
      '﻿<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd" [ <!ELEMENT x ANY> ]>',
      '<!-- before the root -->',
      '<score-partwise version="3.1">\r\n',
      "  <work><work-title>Nocturne &lt;op. 9&gt; &amp; &#233;t&#xE9; &#x1F3B9;</work-title></work>\r",
      '  <credit page=\'1\'><credit-words font-family="a > b" justify="cen\tter\nline">one<!-- aside -->two<![CDATA[ <three> & ]]></credit-words></credit>',
      '  <?app instruction?>',
      '  <part-list><score-part id="P1"><part-name/></score-part></part-list>',
      '  <part id = "P1" ><measure number="1" /></part >',
      '</score-partwise>',
      '<!-- after the root -->',
      '',
    ].join('\n');

    expect(readXml(document)).toEqual(asTheBrowserReadsIt(document.slice(1)));
  });

  it('refuses a document that is not well formed, as the browser would', () => {
    const broken = [
      '<a><b></a>',
      '<a>',
      '<a></b>',
      '<a>&nbsp;</a>',
      '<a>fish & chips</a>',
      '<a>&#0;</a>',
      '<a b=1/>',
      '<a b=x c=x/>',
      '<a b="1" b="2"/>',
      '<a b="1"c="2"/>',
      '<a b="<"/>',
      '<a/><b/>',
      '<a/>tail',
      'head<a/>',
      '<a><!-- never closed</a>',
      '<a><![CDATA[ never closed</a>',
      '<a',
      '<a b="never closed/>',
    ];
    for (const document of broken) {
      expect(() => readXml(document), document).toThrow(NOT_XML);
    }
  });

  it('says a document with nothing in it is empty', () => {
    expect(() => readXml('<?xml version="1.0"?>\n<!-- nothing -->\n')).toThrow(/empty/);
  });
});
