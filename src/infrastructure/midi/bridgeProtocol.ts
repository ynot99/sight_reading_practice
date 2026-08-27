/**
 * Wire format between the desktop MIDI bridge and the browser.
 *
 * Deliberately tiny, one-way and timestamp-free. Timestamps are *not* sent:
 * the bridge's clock and the browser's clock share no origin, and Flow mode
 * grades a press against a beat computed from the browser's clock. Stamping
 * on arrival keeps every comparison on one timeline, and the only error that
 * introduces is the LAN hop - a couple of milliseconds against a tolerance
 * measured in hundreds.
 */
export const BRIDGE_PROTOCOL_VERSION = 1;

export interface BridgeHelloMessage {
  readonly type: 'hello';
  /** Name of the MIDI port the bridge is listening to, if any. */
  readonly device: string | null;
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
}

export interface BridgeNoteOffMessage {
  readonly type: 'noteoff';
  readonly note: number;
}

export interface BridgePedalMessage {
  readonly type: 'pedal';
  readonly down: boolean;
  /** Raw controller value, `0..1`. */
  readonly value: number;
}

export type BridgeMessage =
  | BridgeHelloMessage
  | BridgeDeviceMessage
  | BridgeNoteOnMessage
  | BridgeNoteOffMessage
  | BridgePedalMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toMidiNote(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127
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
    case 'hello':
      return { type: 'hello', device: toDeviceName(parsed['device']) };
    case 'device':
      return { type: 'device', device: toDeviceName(parsed['device']) };
    case 'noteon': {
      const note = toMidiNote(parsed['note']);
      if (note === null) {
        return null;
      }
      const velocity = parsed['velocity'];
      return {
        type: 'noteon',
        note,
        velocity: typeof velocity === 'number' && velocity >= 0 && velocity <= 1 ? velocity : 0.8,
      };
    }
    case 'noteoff': {
      const note = toMidiNote(parsed['note']);
      return note === null ? null : { type: 'noteoff', note };
    }
    case 'pedal': {
      const value = parsed['value'];
      return {
        type: 'pedal',
        down: parsed['down'] === true,
        value: typeof value === 'number' && value >= 0 && value <= 1 ? value : 0,
      };
    }
    default:
      return null;
  }
}
