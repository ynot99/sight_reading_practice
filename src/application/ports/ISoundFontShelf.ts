/** One of a soundfont's presets, as a reader chooses it: by its name, found by its bank and program. */
export interface SoundFontPresetName {
  readonly name: string;
  readonly bank: number;
  readonly program: number;
}

/** Which preset the keys sound from, by the two numbers that find it in its soundfont. */
export interface PresetChoice {
  readonly bank: number;
  readonly program: number;
}

/** The soundfont kept on this device, as the page shows it. */
export interface KeptSoundFont {
  /** What it is called: the name of the file it came from. */
  readonly name: string;
  /** Its presets, by bank and then program. */
  readonly presets: readonly SoundFontPresetName[];
}

/**
 * A soundfont of the reader's own, kept on this device, and which of its
 * presets the keys sound from - or the built-in piano.
 *
 * One kept at a time: a soundfont is tens of megabytes, and one taken in its
 * place is the one wanted now.
 */
export interface ISoundFontShelf {
  /** The soundfont kept, or `null` before one is or while it is still being read on opening. */
  readonly kept: KeptSoundFont | null;
  /** The preset the keys sound from, or `null` for the built-in piano. */
  readonly chosen: PresetChoice | null;
  /**
   * Keeps a soundfont in place of the one kept before, and sounds the keys
   * from its first preset. Refuses, saying why, one that cannot be read or
   * cannot be kept, and the one kept before stays.
   */
  keep(fileName: string, bytes: ArrayBuffer): Promise<void>;
  /** Sounds the keys from one of the kept soundfont's presets, or the built-in piano for `null`, and remembers it. */
  choose(preset: PresetChoice | null): void;
  /** Called whenever what is kept or chosen changes, the reading of it on opening included. */
  onChange(listener: () => void): () => void;
}

