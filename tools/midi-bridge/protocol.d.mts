/** Types for the bridge helpers, so the project's tests can cover them. */
export type BridgeEvent =
  | {
      readonly type: 'noteon';
      readonly note: number;
      readonly velocity: number;
      /** Wall clock at the bridge when the packet arrived, if it was taken. */
      readonly at?: number;
    }
  | { readonly type: 'noteoff'; readonly note: number; readonly at?: number }
  | { readonly type: 'pedal'; readonly down: boolean; readonly value: number }
  | { readonly type: 'control'; readonly controller: number; readonly value: number };

export declare function midiMessageToBridgeEvent(
  message: ArrayLike<number> | null | undefined,
  atMs?: number,
): BridgeEvent | null;

export declare function choosePort(names: readonly string[], requested: string | null): number;
