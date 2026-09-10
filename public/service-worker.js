/*
 * Keeps the application on the tablet once it has been there.
 *
 * His: the app should open without the internet. It is practised on an iPad
 * from a Home Screen icon, and a page that needs a network to draw its own
 * buttons is one that cannot be practised on a train, in a room with bad
 * signal, or with the router off.
 *
 * Nothing is listed here on purpose. A manifest of what to cache is a second
 * copy of the build's output, and the two go out of step the first time
 * anything is renamed - so this caches what the reader has actually asked
 * for, which after one visit is the application and after one piece is that
 * piece's recordings too.
 */
const CACHE = 'sight-reading-practice.v1';

self.addEventListener('install', () => {
  // Straight into service: there is nothing to fetch ahead of time, and a
  // worker waiting for every tab to close is one the reader never gets.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * The page itself, asked for fresh and answered from the shelf when it cannot
 * be.
 *
 * Network first, because the document is what names every hashed file in the
 * build: served from a cache it would pin an old version of the application
 * for ever, and the reader would have no way to ask for a newer one.
 */
async function freshDocument(request) {
  const shelf = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await shelf.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const kept = await shelf.match(request);
    if (kept !== undefined) {
      return kept;
    }
    throw error;
  }
}

/**
 * Everything else, answered from the shelf and put there on the way past.
 *
 * Safe to keep for ever because the names say so: the build stamps a hash
 * into every file it emits, so a changed file is a different name, and the
 * recordings under `samples/` are the same thirty notes they were.
 */
async function keptAsset(request) {
  const shelf = await caches.open(CACHE);
  const kept = await shelf.match(request);
  if (kept !== undefined) {
    return kept;
  }
  const response = await fetch(request);
  if (response.ok) {
    await shelf.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only what this application serves, and only what it reads. A POST is
  // nobody's to answer twice, and another origin's files are not ours to keep.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(request.mode === 'navigate' ? freshDocument(request) : keptAsset(request));
});
