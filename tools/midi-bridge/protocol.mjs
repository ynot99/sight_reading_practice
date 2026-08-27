/**
 * The decisions the bridge makes, separated from the plumbing so they can be
 * tested from the project's own suite. Everything here is pure.
 */
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

/**
 * Turns a raw MIDI packet into the message the browser expects, or `null` for
 * anything the trainer does not care about.
 *
 * A note-on with zero velocity is how a great many keyboards signal note-off,
 * so it is normalised here rather than being left to the client.
 *
 * @param {ArrayLike<number>} message
 * @returns {{type: 'noteon', note: number, velocity: number} | {type: 'noteoff', note: number} | null}
 */
export function midiMessageToBridgeEvent(message) {
  if (message === null || message === undefined || message.length < 3) {
    return null;
  }
  const status = message[0];
  const note = message[1];
  const velocity = message[2];
  if (typeof status !== 'number' || typeof note !== 'number' || typeof velocity !== 'number') {
    return null;
  }

  const command = status & 0xf0;
  if (command === NOTE_ON && velocity > 0) {
    return { type: 'noteon', note, velocity: velocity / 127 };
  }
  if (command === NOTE_OFF || (command === NOTE_ON && velocity === 0)) {
    return { type: 'noteoff', note };
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
