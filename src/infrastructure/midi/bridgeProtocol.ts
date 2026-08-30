/**
 * Wire format between the desktop MIDI bridge and the browser.
 *
 * Deliberately tiny and one-way. A press carries the moment it was struck,
 * because stamping on arrival buries the relay's own delay in the reader's
 * playing - but the two machines' clocks share no origin, so the difference
 * between them has to be measured before a stamp means anything. That is what
 * the ping is for: it costs a few bytes a second and it means the difference
 * is known before a note is played, rather than being worked out from the
 * opening bar and spoiling it. One was found a whole second out.
 */
export const BRIDGE_PROTOCOL_VERSION = 1;

export interface BridgeHelloMessage {
  readonly type: 'hello';
  /** Name of the MIDI port the bridge is listening to, if any. */
  readonly device: string | null;
  /** Wall clock at the bridge, if it sends one. */
  readonly at?: number;
}

/**
 * Nothing but the time, sent every so often.
 *
 * Carries no music at all: it exists so the two clocks can be compared while
 * nobody is playing, which is the only moment at which comparing them cannot
 * spoil anything.
 */
export interface BridgePingMessage {
  readonly type: 'ping';
  readonly at: number;
}

export interface BridgeDeviceMessage {
  readonly type: 'device';
  readonly device: string | null;
}

export interface BridgeNoteOnMessage {
  readonly type: 'noteon';
  readonly note: number;
  /** Normalised to `0..1` by the bridge. */
  readonly velocity: number;
  /**
   * Wall clock at the bridge when the key was struck, if it was taken.
   *
   * Optional because an older bridge does not send it, and a tablet that
   * insisted would stop working the moment the two were out of step.
   */
  readonly at?: number;
}

export interface BridgeNoteOffMessage {
  readonly type: 'noteoff';
  readonly note: number;
  readonly at?: number;
}

export interface BridgePedalMessage {
  readonly type: 'pedal';
  readonly down: boolean;
  /** Raw controller value, `0..1`. */
  readonly value: number;
  /** Stamped at the keyboard, like a note; see {@link BridgeNoteOnMessage}. */
  readonly at?: number;
}

/** Any other knob, by the number it sends. See {@link MidiControlEvent}. */
export interface BridgeControlMessage {
  readonly type: 'control';
  readonly controller: number;
  readonly value: number;
  readonly at?: number;
}

export type BridgeMessage =
  | BridgePingMessage
  | BridgeHelloMessage
  | BridgeDeviceMessage
  | BridgeNoteOnMessage
  | BridgeNoteOffMessage
  | BridgePedalMessage
  | BridgeControlMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toMidiNote(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127
    ? value
    : null;
}

/**
 * A wall-clock reading from the bridge, or `null` for one not worth trusting.
 *
 * Only a plausible epoch time is taken. A bridge whose clock is unset reports
 * something near zero, and using it would place every note decades before the
 * run began - which is worse than having no stamp at all, since it looks like
 * an answer.
 */
function toStamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 1_000_000_000_000
    ? value
    : null;
}

function toDeviceName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Decodes one frame.
 *
 * Returns `null` for anything unrecognised rather than throwing: a bridge
 * from a newer version of the project must be able to send messages this
 * client has never heard of without breaking the practice session.
 */
export function parseBridgeMessage(raw: unknown): BridgeMessage | null {
  if (typeof raw !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  switch (parsed['type']) {
    case 'ping': {
      const at = toStamp(parsed['at']);
      return at === null ? null : { type: 'ping', at };
    }
    case 'hello': {
      const at = toStamp(parsed['at']);
      return {
        type: 'hello',
        device: toDeviceName(parsed['device']),
        ...(at === null ? {} : { at }),
      };
    }
    case 'device':
      return { type: 'device', device: toDeviceName(parsed['device']) };
    case 'noteon': {
      const note = toMidiNote(parsed['note']);
      if (note === null) {
        return null;
      }
      const velocity = parsed['velocity'];
      const at = toStamp(parsed['at']);
      return {
        type: 'noteon',
        note,
        velocity: typeof velocity === 'number' && velocity >= 0 && velocity <= 1 ? velocity : 0.8,
        ...(at === null ? {} : { at }),
      };
    }
    case 'noteoff': {
      const note = toMidiNote(parsed['note']);
      const at = toStamp(parsed['at']);
      if (note === null) {
        return null;
      }
      return at === null ? { type: 'noteoff', note } : { type: 'noteoff', note, at };
    }
    case 'pedal': {
      const value = parsed['value'];
      const at = toStamp(parsed['at']);
      return {
        type: 'pedal',
        down: parsed['down'] === true,
        value: typeof value === 'number' && value >= 0 && value <= 1 ? value : 0,
        ...(at === null ? {} : { at }),
      };
    }
    case 'control': {
      const controller = toMidiNote(parsed['controller']);
      const value = parsed['value'];
      const at = toStamp(parsed['at']);
      if (controller === null || typeof value !== 'number' || value < 0 || value > 1) {
        return null;
      }
      return at === null ? { type: 'control', controller, value } : { type: 'control', controller, value, at };
    }
    default:
      return null;
  }
}
