import { DomainError } from '../../shared/errors.js';

export type XmlAttributes = Readonly<Record<string, string | number | undefined>>;

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

/**
 * Tiny indentation-aware XML builder.
 *
 * Keeping this separate from the MusicXML rules means the serializer reads
 * like the document it produces, and unbalanced tags fail loudly instead of
 * emitting a broken score.
 */
export class XmlWriter {
  private readonly lines: string[] = [];
  private readonly stack: string[] = [];
  private readonly indentUnit: string;

  constructor(indentUnit = '  ') {
    this.indentUnit = indentUnit;
  }

  private get indent(): string {
    return this.indentUnit.repeat(this.stack.length);
  }

  private static attributeString(attributes: XmlAttributes | undefined): string {
    if (attributes === undefined) {
      return '';
    }
    return Object.entries(attributes)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([name, value]) => ` ${name}="${escapeXmlAttribute(String(value))}"`)
      .join('');
  }

  /** Appends a verbatim line, e.g. the XML declaration. */
  raw(line: string): this {
    this.lines.push(line);
    return this;
  }

  open(tag: string, attributes?: XmlAttributes): this {
    this.lines.push(`${this.indent}<${tag}${XmlWriter.attributeString(attributes)}>`);
    this.stack.push(tag);
    return this;
  }

  close(): this {
    const tag = this.stack.pop();
    if (tag === undefined) {
      throw new DomainError('XmlWriter.close() called with no open element.');
    }
    this.lines.push(`${this.indent}</${tag}>`);
    return this;
  }

  /** Convenience wrapper: opens, runs `body`, then closes. */
  element(tag: string, attributes: XmlAttributes | undefined, body: () => void): this {
    this.open(tag, attributes);
    body();
    return this.close();
  }

  /** A leaf element. Omitting `text` produces a self-closing tag. */
  leaf(tag: string, text?: string | number, attributes?: XmlAttributes): this {
    const attributeString = XmlWriter.attributeString(attributes);
    if (text === undefined) {
      this.lines.push(`${this.indent}<${tag}${attributeString}/>`);
    } else {
      this.lines.push(
        `${this.indent}<${tag}${attributeString}>${escapeXmlText(String(text))}</${tag}>`,
      );
    }
    return this;
  }

  toString(): string {
    if (this.stack.length > 0) {
      throw new DomainError(`Unclosed XML elements: ${this.stack.join(' > ')}.`);
    }
    return `${this.lines.join('\n')}\n`;
  }
}
