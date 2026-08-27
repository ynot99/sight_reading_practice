#!/usr/bin/env node
/**
 * Rebuilds the bundled piano samples.
 *
 * The source is the Salamander Grand Piano V3 by Alexander Holm (CC-BY 3.0),
 * a 1.9 GB library of a Yamaha C5 recorded at 16 velocity layers. None of that
 * can go into a browser, so this takes the subset Tone.js publishes - one
 * velocity layer, one note every three semitones - and cuts it down further:
 *
 *   422 seconds of stereo audio   ->  142 MB once decoded in memory
 *   trimmed to 5 s and made mono  ->   25 MB
 *
 * The player fills the two semitones between samples by resampling, which is
 * exactly what a hardware sampler does.
 *
 * Requires ffmpeg on PATH. Run it from anywhere:
 *
 *   node tools/samples/fetch-piano-samples.mjs
 *   node tools/samples/fetch-piano-samples.mjs --seconds 8 --bitrate 128k
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, '..', '..', 'public', 'samples', 'piano');
const SOURCE = 'https://tonejs.github.io/audio/salamander';

/** Every third semitone from A0 to C8, which is the whole 88-key range. */
const NOTES = (() => {
  const names = [];
  for (let octave = 0; octave <= 8; octave += 1) {
    for (const step of ['A', 'C', 'Ds', 'Fs']) {
      const name = `${step}${octave}`;
      // The set starts at A0 and stops at C8: nothing below or above exists.
      if ((octave === 0 && step !== 'A') || (octave === 8 && step !== 'C')) {
        continue;
      }
      names.push(name);
    }
  }
  return names;
})();

function parseArguments(argv) {
  const options = { seconds: 5, fade: 0.5, bitrate: '96k', channels: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    switch (argv[index]) {
      case '--seconds':
        options.seconds = Number.parseFloat(value ?? '');
        index += 1;
        break;
      case '--fade':
        options.fade = Number.parseFloat(value ?? '');
        index += 1;
        break;
      case '--bitrate':
        options.bitrate = value ?? options.bitrate;
        index += 1;
        break;
      case '--stereo':
        options.channels = 2;
        break;
      default:
        break;
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const scratch = join(OUTPUT_DIR, '.download');
  mkdirSync(scratch, { recursive: true });

  let total = 0;
  for (const note of NOTES) {
    const url = `${SOURCE}/${note}.mp3`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url} responded ${response.status}`);
    }
    const raw = join(scratch, `${note}.mp3`);
    writeFileSync(raw, Buffer.from(await response.arrayBuffer()));

    const fadeStart = Math.max(0, options.seconds - options.fade);
    execFileSync('ffmpeg', [
      '-y',
      '-v', 'error',
      '-i', raw,
      '-t', String(options.seconds),
      '-af', `afade=t=out:st=${fadeStart}:d=${options.fade}`,
      '-ac', String(options.channels),
      '-b:a', options.bitrate,
      join(OUTPUT_DIR, `${note}.mp3`),
    ]);
    total += 1;
    process.stdout.write(`\r  ${total}/${NOTES.length} ${note}      `);
  }

  rmSync(scratch, { recursive: true, force: true });
  process.stdout.write('\n');
  console.log(`Wrote ${total} samples to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
