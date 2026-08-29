import { describe, expect, it } from 'vitest';
import { choosePort, midiMessageToBridgeEvent } from '../../tools/midi-bridge/protocol.mjs';
import { parseBridgeMessage } from '../../src/infrastructure/midi/bridgeProtocol.js';

/**
 * The desktop bridge is a separate, dependency-free script, but the two ends
 * of the wire have to agree. These tests cover the bridge's own decisions and
 * then feed its output straight into the browser-side parser.
 */
describe('bridge MIDI decoding', () => {
  it('decodes note on and note off', () => {
    expect(midiMessageToBridgeEvent([0x90, 60, 127])).toEqual({
      type: 'noteon',
      note: 60,
      velocity: 1,
    });
    expect(midiMessageToBridgeEvent([0x80, 60, 0])).toEqual({ type: 'noteoff', note: 60 });
  });

  it('normalises velocity into 0..1', () => {
    const event = midiMessageToBridgeEvent([0x90, 64, 64]);
    expect(event?.type).toBe('noteon');
    expect(event && 'velocity' in event ? event.velocity : 0).toBeCloseTo(0.504, 3);
  });

  it('treats a zero-velocity note on as a release', () => {
    // Plenty of keyboards, Casio included, never send 0x80 at all.
    expect(midiMessageToBridgeEvent([0x95, 60, 0])).toEqual({ type: 'noteoff', note: 60 });
  });

  it('reads notes on any channel', () => {
    for (let channel = 0; channel < 16; channel += 1) {
      expect(midiMessageToBridgeEvent([0x90 | channel, 72, 100])?.type).toBe('noteon');
    }
  });

  it('decodes the sustain pedal', () => {
    expect(midiMessageToBridgeEvent([0xb0, 64, 127])).toEqual({
      type: 'pedal',
      down: true,
      value: 1,
    });
    expect(midiMessageToBridgeEvent([0xb0, 64, 0])).toMatchObject({ down: false });
  });

  it('forwards any other knob by number', () => {
    // The tablet is where a reader teaches the app their knob, and it can
    // only learn what reaches it: a bridge that dropped this would make the
    // feature work at the desk and nowhere else.
    expect(midiMessageToBridgeEvent([0xb0, 7, 127])).toEqual({
      type: 'control',
      controller: 7,
      value: 1,
    });
  });

  it('ignores everything that is not a note, the damper or a knob', () => {
    expect(midiMessageToBridgeEvent([0xe0, 0, 64])).toBeNull(); // pitch bend
    expect(midiMessageToBridgeEvent([0xf8])).toBeNull(); // clock
    expect(midiMessageToBridgeEvent([0x90, 60])).toBeNull(); // truncated
    expect(midiMessageToBridgeEvent([])).toBeNull();
    expect(midiMessageToBridgeEvent(null)).toBeNull();
  });
});

describe('bridge device selection', () => {
  const inputs = ['Microsoft GS Wavetable Synth', 'CASIO USB-MIDI', 'loopMIDI Port'];

  it('takes the first input when nothing is requested', () => {
    expect(choosePort(inputs, null)).toBe(0);
    expect(choosePort(inputs, '')).toBe(0);
  });

  it('matches a requested name loosely and case-insensitively', () => {
    expect(choosePort(inputs, 'casio')).toBe(1);
    expect(choosePort(inputs, 'usb-midi')).toBe(1);
    expect(choosePort(inputs, 'loop')).toBe(2);
  });

  it('reports no port rather than guessing', () => {
    expect(choosePort(inputs, 'yamaha')).toBe(-1);
    expect(choosePort([], null)).toBe(-1);
    expect(choosePort([], 'casio')).toBe(-1);
  });
});

describe('the two ends of the wire agree', () => {
  it('produces frames the browser adapter accepts', () => {
    const onWire = [
      midiMessageToBridgeEvent([0x90, 60, 100]),
      midiMessageToBridgeEvent([0x80, 60, 0]),
    ];

    for (const event of onWire) {
      expect(event).not.toBeNull();
      const frame = JSON.stringify({ v: 1, ...event });
      expect(parseBridgeMessage(frame)).toEqual(event);
    }
  });
});

describe('stamping a press where it happened', () => {
  it('carries the bridge’s own reading when it is given one', () => {
    // Taken at the source, the LAN hop and the tablet's scheduling fall
    // outside the measurement - and neither of those is steady, which is why
    // a press exactly on the beat could read as late by a different amount
    // each time.
    expect(midiMessageToBridgeEvent([0x90, 60, 100], 1_700_000_000_000)).toMatchObject({
      type: 'noteon',
      at: 1_700_000_000_000,
    });
    expect(midiMessageToBridgeEvent([0x80, 60, 0], 1_700_000_000_001)).toMatchObject({
      type: 'noteoff',
      at: 1_700_000_000_001,
    });
  });

  it('says nothing about when, rather than guessing', () => {
    // An older bridge sends no reading, and the tablet has to be able to tell
    // that apart from a reading of zero.
    const event = midiMessageToBridgeEvent([0x90, 60, 100]);
    expect(event).not.toBeNull();
    expect(event === null ? true : 'at' in event).toBe(false);
  });
});
