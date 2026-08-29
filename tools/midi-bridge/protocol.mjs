/**
 * The decisions the bridge makes, separated from the plumbing so they can be
 * tested from the project's own suite. Everything here is pure.
 */
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
/** Controller number of the damper (sustain) pedal. */
const SUSTAIN_CONTROLLER = 64;

/**
 * Turns a raw MIDI packet into the message the browser expects, or `null` for
 * anything the trainer does not care about.
 *
 * A note-on with zero velocity is how a great many keyboards signal note-off,
 * so it is normalised here rather than being left to the client.
 *
 * @param {ArrayLike<number>} message
 * @param {number} [atMs] wall-clock reading taken as the packet arrived
 * @returns {{type: 'noteon', note: number, velocity: number, at?: number} | {type: 'noteoff', note: number, at?: number} | {type: 'pedal', down: boolean, value: number} | {type: 'control', controller: number, value: number} | null}
 */
export function midiMessageToBridgeEvent(message, atMs) {
  if (message === null || message === undefined || message.length < 3) {
    return null;
  }
  const status = message[0];
  const note = message[1];
  const velocity = message[2];
  if (typeof status !== 'number' || typeof note !== 'number' || typeof velocity !== 'number') {
    return null;
  }

  // Stamped here, at the source, when the caller supplies a reading.
  //
  // The browser used to stamp on arrival, which put the LAN hop and the
  // tablet's own scheduling inside every measurement - and neither is
  // constant, so a press that was on the beat could read as late by a
  // different amount each time. Taken here, that jitter is gone and only the
  // difference between the two machines' clocks is left, which is steady
  // enough to be seen and subtracted.
  const at = typeof atMs === 'number' ? { at: atMs } : {};
  const command = status & 0xf0;
  if (command === NOTE_ON && velocity > 0) {
    return { type: 'noteon', note, velocity: velocity / 127, ...at };
  }
  if (command === NOTE_OFF || (command === NOTE_ON && velocity === 0)) {
    return { type: 'noteoff', note, ...at };
  }
  // The sustain pedal, which the trainer sounds but never judges.
  if (command === CONTROL_CHANGE && note === SUSTAIN_CONTROLLER) {
    return { type: 'pedal', down: velocity >= 64, value: velocity / 127 };
  }
  // Any other knob, forwarded by number. The bridge decides nothing about
  // what it means; the tablet is where a reader teaches the app their knob,
  // and it can only learn what reaches it.
  if (command === CONTROL_CHANGE) {
    return { type: 'control', controller: note, value: velocity / 127 };
  }
  return null;
}

/**
 * Index of the MIDI input to listen to.
 *
 * With no preference the first input wins, which is the common case of one
 * keyboard on the desk. A name is matched loosely because drivers decorate
 * them differently on every platform ("CASIO USB-MIDI", "Privia 2", ...).
 *
 * @param {readonly string[]} names
 * @param {string | null} requested lower-case substring, or null for "any"
 * @returns {number} index into `names`, or -1 when there is nothing to open
 */
export function choosePort(names, requested) {
  if (names.length === 0) {
    return -1;
  }
  if (requested === null || requested === '') {
    return 0;
  }
  return names.findIndex((name) => name.toLowerCase().includes(requested));
}
