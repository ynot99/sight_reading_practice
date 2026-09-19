/** What the reader is shown, to confirm a sign-in on another device. */
export interface SignInCode {
  readonly code: string;
  /** Where to enter it. */
  readonly url: string;
}

/**
 * Signing in to the drive by a code confirmed on another device.
 *
 * For a browser that will not open the provider's own sign-in window: his
 * iPad's, the one browser there with Web MIDI, refuses Google's page. The
 * code is entered on a phone or a computer instead, and this device only ever
 * talks to the provider's servers. Once confirmed it stays signed in - it is
 * handed a key to ask for new tokens with - so a sync nobody pressed for goes
 * on past the hour a token lasts.
 */
export interface ICodeSignIn {
  /** Whether this copy of the trainer was built with what signing in by code needs. */
  readonly available: boolean;
  /** Shows the code through `show`, and settles once it is confirmed, refused or run out. */
  signInWithCode(show: (code: SignInCode) => void): Promise<void>;
}
