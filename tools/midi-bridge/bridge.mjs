#!/usr/bin/env node
/**
 * Desktop MIDI bridge for the sight-reading trainer.
 *
 * Why this exists: iPadOS has no Web MIDI API in any browser, so a tablet can
 * never see a keyboard by itself. Plug the keyboard into this computer instead
 * and run this script; it serves the trainer on the local network and relays
 * every note to whatever device is showing the page.
 *
 *   node bridge.mjs                 serve ../../dist and relay the first input
 *   node bridge.mjs --list          list the MIDI inputs this computer sees
 *   node bridge.mjs --device casio  pick an input by (partial) name
 *   node bridge.mjs --port 4000     listen on a different HTTP port
 *
 * Plain JavaScript on purpose: it has to run with `node bridge.mjs` and
 * nothing else, on a machine that may not have the app's toolchain set up.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import midi from '@julusian/midi';
import { WebSocketServer } from 'ws';
import { choosePort, midiMessageToBridgeEvent } from './protocol.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // Safari ignores a manifest it is not handed as one, and "Add to Home
  // Screen" then makes a bookmark that opens the browser instead of an app.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.md': 'text/markdown; charset=utf-8',
};

const DEVICE_POLL_MS = 1_000;

function parseArguments(argv) {
  const options = {
    port: 8080,
    device: null,
    root: resolve(HERE, '..', '..', 'dist'),
    list: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--list':
        options.list = true;
        break;
      case '--port':
        options.port = Number.parseInt(value ?? '', 10);
        index += 1;
        break;
      case '--device':
        options.device = (value ?? '').toLowerCase();
        index += 1;
        break;
      case '--root':
        options.root = resolve(value ?? '');
        index += 1;
        break;
      default:
        break;
    }
  }
  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error('--port must be a positive integer');
  }
  return options;
}

function listInputs(input) {
  const count = input.getPortCount();
  const names = [];
  for (let index = 0; index < count; index += 1) {
    names.push(input.getPortName(index));
  }
  return names;
}

function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function serveStatic(root, request, response) {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');

  let relative;
  try {
    relative = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  const candidate = normalize(join(root, relative === '/' ? 'index.html' : relative));

  // Never serve anything outside the published build. The separator matters:
  // a plain prefix test would also accept a sibling directory whose name
  // merely starts with the same characters.
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  const target =
    existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, 'index.html');

  if (!existsSync(target)) {
    response
      .writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      .end('No build found. Run "npm run build" in the project root first.');
    return;
  }

  // The samples are 1.7 MB and never change; the app shell must not be
  // cached, or a rebuild would not reach the tablet.
  const isSample = target.includes(`${sep}samples${sep}`);
  response.writeHead(200, {
    'content-type': MIME_TYPES[extname(target)] ?? 'application/octet-stream',
    'cache-control': isSample ? 'public, max-age=604800' : 'no-cache',
  });
  createReadStream(target).pipe(response);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const input = new midi.Input();

  if (options.list) {
    const names = listInputs(input);
    if (names.length === 0) {
      console.log('No MIDI inputs found. Is the keyboard switched on and plugged in?');
    } else {
      names.forEach((name, index) => {
        console.log(`${index}: ${name}`);
      });
    }
    process.exit(0);
  }

  if (!existsSync(options.root)) {
    console.error(`No build at ${options.root}`);
    console.error('Run "npm run build" in the project root, then start the bridge again.');
    process.exit(1);
  }

  const server = createServer((request, response) => {
    serveStatic(options.root, request, response);
  });
  const sockets = new WebSocketServer({ server, path: '/midi' });

  let openPortIndex = -1;
  let openPortName = null;

  const broadcast = (message) => {
    const payload = JSON.stringify({ v: 1, ...message });
    for (const client of sockets.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  };

  // Clock, sysex and active-sensing traffic is constant on many keyboards and
  // is of no interest here.
  input.ignoreTypes(true, true, true);
  input.on('message', (_deltaTime, message) => {
    // Read first, before anything else can take a millisecond.
    const event = midiMessageToBridgeEvent(message, Date.now());
    if (event !== null) {
      broadcast(event);
    }
  });

  /** Opens the chosen input, and reopens it when the keyboard is replugged. */
  const syncDevice = () => {
    const names = listInputs(input);
    const wanted = choosePort(names, options.device);

    if (wanted === -1) {
      if (openPortIndex !== -1) {
        input.closePort();
        openPortIndex = -1;
        openPortName = null;
        console.log('MIDI device disconnected.');
        broadcast({ type: 'device', device: null });
      }
      return;
    }

    const wantedName = names[wanted] ?? null;
    if (openPortIndex === wanted && openPortName === wantedName) {
      return;
    }

    if (openPortIndex !== -1) {
      input.closePort();
    }
    input.openPort(wanted);
    openPortIndex = wanted;
    openPortName = wantedName;
    console.log(`Listening to MIDI input: ${wantedName}`);
    broadcast({ type: 'device', device: wantedName });
  };

  sockets.on('connection', (client) => {
    client.send(JSON.stringify({ v: 1, type: 'hello', device: openPortName, at: Date.now() }));
    console.log(`Screen connected (${sockets.clients.size} total).`);
    client.on('close', () => {
      console.log(`Screen disconnected (${sockets.clients.size} left).`);
    });
  });

  syncDevice();
  const poll = setInterval(() => {
    syncDevice();
    // Nothing but the time. The page joins our clock to its own by it, and
    // doing that while nobody is playing is the only way it cannot spoil the
    // playing: worked out from the opening bar instead, a clock a second out
    // put that bar a second out with it.
    broadcast({ type: 'ping', at: Date.now() });
  }, DEVICE_POLL_MS);

  server.listen(options.port, () => {
    console.log('');
    console.log('  Sight-reading bridge is running.');
    console.log('  Open this on the iPad (same Wi-Fi network):');
    console.log('');
    for (const address of localAddresses()) {
      console.log(`      http://${address}:${options.port}/`);
    }
    console.log('');
    console.log(`  On this computer:  http://localhost:${options.port}/`);
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });

  const shutdown = () => {
    clearInterval(poll);
    if (openPortIndex !== -1) {
      input.closePort();
    }
    sockets.close();
    server.close(() => process.exit(0));
    // Do not let a stuck socket hold the process open.
    setTimeout(() => process.exit(0), 500).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
