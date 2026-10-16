import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

/** Where the page is published, which every address a preview fetches is whole from. */
const SITE = 'https://ynot99.github.io/sight_reading_practice/';

/** The content of a `<meta>` named by `name` or `property`, or `null`. */
function meta(key: string): string | null {
  return new RegExp(`<meta (?:name|property)="${key.replace(/[:.]/g, '\\$&')}" content="([^"]*)"`).exec(HTML)?.[1] ?? null;
}

describe('what the page says of itself to a search engine and a shared link', () => {
  it('describes itself in words a result can show whole', () => {
    const description = meta('description');
    expect(description).toMatch(/sight-reading/);
    // A result shows about this much before it cuts the words off.
    expect(description?.length).toBeLessThanOrEqual(155);
    // Said the same everywhere it is said.
    for (const key of ['og:description', 'twitter:description']) {
      expect(meta(key), key).toBe(description);
    }
    expect(HTML).toContain(`<noscript>`);
    expect(/<noscript>[\s\S]*?<p>([^<]*)<\/p>/.exec(HTML)?.[1]).toBe(description);
  });

  it('names its one address, and fetches its preview from whole addresses', () => {
    expect(HTML).toContain(`<link rel="canonical" href="${SITE}" />`);
    expect(meta('og:url')).toBe(SITE);
    expect(meta('og:image')).toBe(`${SITE}og-image.png`);
    expect(meta('twitter:image')).toBe(`${SITE}og-image.png`);
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('og:title')).toBe(/<title>([^<]*)<\/title>/.exec(HTML)?.[1]);
  });

  it('has the preview it names, at the size it says', () => {
    const image = readFileSync(resolve(process.cwd(), 'public/og-image.png'));
    // A PNG says its width and height in its first chunk.
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([
      Number(meta('og:image:width')),
      Number(meta('og:image:height')),
    ]);
    expect([meta('og:image:width'), meta('og:image:height')]).toEqual(['1200', '630']);
  });

  it('says what it is as data a search engine reads, and lists its address for one', () => {
    const data = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(HTML)?.[1] ?? '';
    const said = JSON.parse(data) as Record<string, unknown>;
    expect(said['@type']).toBe('WebApplication');
    expect(said['url']).toBe(SITE);
    expect(said['description']).toBe(meta('description'));
    expect(readFileSync(resolve(process.cwd(), 'public/sitemap.xml'), 'utf8')).toContain(`<loc>${SITE}</loc>`);
  });
});
