import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The worker, run in a scope of our own.
 *
 * It is plain JavaScript served as it is written - it has to be, since a
 * service worker is fetched by the browser rather than bundled - so the only
 * way to say what it does is to run it. Every global it touches is handed in,
 * which is also the list of what it is allowed to touch.
 */
interface Scope {
  readonly fetches: string[];
  readonly shelf: Map<string, Response>;
  handle(request: FakeRequest): Promise<Response>;
}

interface FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
}

function runTheWorker(options: {
  readonly offline?: boolean;
  readonly kept?: ReadonlyMap<string, string>;
}): Scope {
  const fetches: string[] = [];
  const shelf = new Map<string, Response>();
  for (const [url, body] of options.kept ?? []) {
    shelf.set(url, new Response(body));
  }

  const cache = {
    match: (request: FakeRequest) => Promise.resolve(shelf.get(request.url)),
    put: (request: FakeRequest, response: Response) => {
      shelf.set(request.url, response);
      return Promise.resolve();
    },
  };
  const caches = {
    open: () => Promise.resolve(cache),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
  };

  let onFetch: ((event: { request: FakeRequest; respondWith: (value: Promise<Response>) => void }) => void) | null =
    null;
  const self = {
    location: { origin: 'https://example.test' },
    skipWaiting: () => undefined,
    clients: { claim: () => Promise.resolve() },
    addEventListener: (name: string, listener: unknown) => {
      if (name === 'fetch') {
        onFetch = listener as typeof onFetch;
      }
    },
  };
  const fetcher = (request: FakeRequest): Promise<Response> => {
    fetches.push(request.url);
    return options.offline === true
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(new Response('from the network'));
  };

  const source = readFileSync('public/service-worker.js', 'utf-8');
  // eslint-disable-next-line no-new-func -- running the file is the only way to say what it does.
  new Function('self', 'caches', 'fetch', source)(self, caches, fetcher);

  return {
    fetches,
    shelf,
    handle: (request: FakeRequest) => {
      let answer: Promise<Response> | null = null;
      onFetch?.({ request, respondWith: (value) => (answer = value) });
      return answer ?? Promise.reject(new Error('the worker did not answer'));
    },
  };
}

const page: FakeRequest = {
  url: 'https://example.test/',
  method: 'GET',
  mode: 'navigate',
};
const asset: FakeRequest = {
  url: 'https://example.test/assets/main.abc123.js',
  method: 'GET',
  mode: 'no-cors',
};

describe('keeping the trainer on the device', () => {
  it('serves the page from the shelf when there is no network', async () => {
    // His, and the whole point: it is practised on a tablet from a Home
    // Screen icon, and a page that needs a network to draw its own buttons
    // cannot be practised on a train.
    const worker = runTheWorker({
      offline: true,
      kept: new Map([[page.url, 'the page as it was']]),
    });

    expect(await (await worker.handle(page)).text()).toBe('the page as it was');
  });

  it('asks for the page fresh whenever it can', async () => {
    // Network first, because the document names every hashed file in the
    // build. Served from the shelf it would pin one version of the
    // application for ever, and the reader would have no way to ask for a
    // newer one.
    const worker = runTheWorker({ kept: new Map([[page.url, 'yesterday']]) });

    expect(await (await worker.handle(page)).text()).toBe('from the network');
    expect(worker.fetches).toEqual([page.url]);
  });

  it('answers everything else from the shelf without asking', async () => {
    // Safe to keep because the names say so: the build stamps a hash into
    // every file it emits, so a changed file is a different name.
    const worker = runTheWorker({ kept: new Map([[asset.url, 'the built code']]) });

    expect(await (await worker.handle(asset)).text()).toBe('the built code');
    expect(worker.fetches).toEqual([]);
  });

  it('puts what it had to fetch on the shelf for next time', async () => {
    const worker = runTheWorker({});

    await worker.handle(asset);

    expect(worker.shelf.has(asset.url)).toBe(true);
  });

  it('leaves another origin, and anything but a read, alone', async () => {
    // A POST is nobody's to answer twice, and another origin's files are not
    // ours to keep.
    const worker = runTheWorker({});

    await expect(worker.handle({ ...asset, method: 'POST' })).rejects.toThrow();
    await expect(
      worker.handle({ ...asset, url: 'https://elsewhere.test/thing.js' }),
    ).rejects.toThrow();
  });
});
