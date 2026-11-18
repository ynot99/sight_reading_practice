import type {
  ISoundFontShelf,
  KeptSoundFont,
  PresetChoice,
  SoundFontPresetName,
} from '../../application/ports/ISoundFontShelf.js';
import { SightReadingError } from '../../shared/errors.js';
import type { ShelfDatabase } from '../storage/DatabaseShelf.js';
import { readSoundFont, type SoundFont, type SoundFontPreset } from './soundFont.js';

/** What the instrument is asked: to sound its keys from a preset, or from its own recordings for `null`. */
export interface SoundFontInstrument {
  useSoundFont(chosen: { readonly font: SoundFont; readonly preset: SoundFontPreset } | null): void;
}

/**
 * Where the soundfont is kept: the file under one key, and which of its
 * presets sounds under another, so that choosing a preset does not write
 * tens of megabytes again.
 */
export const SOUNDFONT_KEY = 'soundfont';
export const SOUNDFONT_CHOSEN_KEY = 'soundfont-chosen';

/** Raised when a soundfont was read but this device would not keep it. */
export class SoundFontNotKept extends SightReadingError {}

interface Kept {
  readonly name: string;
  readonly font: SoundFont;
  readonly presets: readonly SoundFontPresetName[];
}

/**
 * The reader's soundfont, kept in the browser's database, and the preset the
 * keys sound from.
 *
 * Opened after the page is up rather than before it: tens of megabytes read
 * from the database would hold up every page for a sound only some readers
 * chose. Until it is read the keys sound from the built-in piano, and
 * whatever shows the choice is told once it has been.
 *
 * Where there is no database the soundfont is kept for the visit only.
 */
export class SoundFontShelf implements ISoundFontShelf {
  private readonly database: ShelfDatabase | null;
  private readonly instrument: SoundFontInstrument;
  private readonly listeners = new Set<() => void>();
  private held: Kept | null = null;
  private choice: PresetChoice | null = null;

  constructor(database: ShelfDatabase | null, instrument: SoundFontInstrument) {
    this.database = database;
    this.instrument = instrument;
  }

  get kept(): KeptSoundFont | null {
    return this.held === null ? null : { name: this.held.name, presets: this.held.presets };
  }

  get chosen(): PresetChoice | null {
    return this.choice;
  }

  /**
   * Reads what was kept on an earlier visit, and sounds the keys from the
   * preset chosen then. A soundfont that can no longer be read is let go of
   * rather than refused again on every visit.
   */
  async open(): Promise<void> {
    let file: unknown;
    let chosen: unknown;
    try {
      file = await this.database?.get(SOUNDFONT_KEY);
      chosen = await this.database?.get(SOUNDFONT_CHOSEN_KEY);
    } catch {
      return;
    }
    try {
      const { name, bytes } = file as { readonly name?: unknown; readonly bytes?: unknown };
      // Read as any other file would be: nothing kept, what was not kept by
      // this, or what was and has since been spoiled, is not a soundfont.
      this.held = theKept(typeof name === 'string' ? name : '', bytes as ArrayBuffer);
    } catch {
      await this.database?.delete(SOUNDFONT_KEY).catch(() => undefined);
      return;
    }
    // Whatever was kept as the choice is found among the presets or is not:
    // anything but one of them sounds the built-in piano.
    this.sound((chosen ?? null) as PresetChoice | null);
  }

  async keep(fileName: string, bytes: ArrayBuffer): Promise<void> {
    const kept = theKept(fileName.replace(/\.sf2$/i, ''), bytes);
    if (this.database !== null) {
      try {
        await this.database.put(SOUNDFONT_KEY, { name: kept.name, bytes });
      } catch (error) {
        throw new SoundFontNotKept(
          `${kept.name} was read but this device would not keep it${error instanceof Error ? `: ${error.message}` : ''}.`,
        );
      }
    }
    this.held = kept;
    const [first] = kept.presets;
    this.choose(first === undefined ? null : { bank: first.bank, program: first.program });
  }

  choose(preset: PresetChoice | null): void {
    this.sound(preset);
    void this.database?.put(SOUNDFONT_CHOSEN_KEY, this.choice).catch(() => undefined);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Sounds the keys from `preset` where the kept soundfont has it, and from the built-in piano otherwise. */
  private sound(preset: PresetChoice | null): void {
    const found =
      preset === null
        ? undefined
        : this.held?.font.presets.find((each) => each.bank === preset.bank && each.program === preset.program);
    this.choice = found === undefined ? null : { bank: found.bank, program: found.program };
    this.instrument.useSoundFont(found === undefined || this.held === null ? null : { font: this.held.font, preset: found });
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function theKept(name: string, bytes: ArrayBuffer): Kept {
  const font = readSoundFont(new Uint8Array(bytes));
  const presets = font.presets
    .map(({ name: presetName, bank, program }) => ({ name: presetName, bank, program }))
    .sort((one, other) => one.bank - other.bank || one.program - other.program);
  return { name: name === '' ? font.name : name, font, presets };
}
