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

  it('ignores everything that is not a note', () => {
    expect(midiMessageToBridgeEvent([0xb0, 64, 127])).toBeNull(); // sustain pedal
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
