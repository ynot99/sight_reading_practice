/**
 * A sound source whose loudness the user can set.
 *
 * Kept apart from {@link IMetronome} and {@link IPitchPlayer} on purpose: the
 * practice session has no business knowing how loud anything is, so it never
 * sees this interface. Only the view does.
 */
export interface IVolumeControl {
  /** `0` is silent, `1` is as loud as this source goes. */
  readonly volume: number;
  setVolume(volume: number): void;
}

/**
 * Turns a linear slider into a loudness curve.
 *
 * Loudness is perceived roughly logarithmically, so a linear gain makes the
 * top half of a slider do almost nothing. Squaring gives a taper that feels
 * even under the finger.
 */
export function volumeToGain(volume: number, maximumGain: number): number {
  const clamped = Math.min(1, Math.max(0, volume));
  return clamped * clamped * maximumGain;
}
