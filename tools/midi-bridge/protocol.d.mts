/** Types for the bridge helpers, so the project's tests can cover them. */
export type BridgeEvent =
  | { readonly type: 'noteon'; readonly note: number; readonly velocity: number }
  | { readonly type: 'noteoff'; readonly note: number }
  | { readonly type: 'pedal'; readonly down: boolean; readonly value: number }
  | { readonly type: 'control'; readonly controller: number; readonly value: number };

export declare function midiMessageToBridgeEvent(
  message: ArrayLike<number> | null | undefined,
): BridgeEvent | null;

export declare function choosePort(names: readonly string[], requested: string | null): number;
