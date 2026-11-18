import type { ShelfDatabase } from '../../src/infrastructure/storage/DatabaseShelf.js';
import type { SoundFontInstrument } from '../../src/infrastructure/audio/SoundFontShelf.js';
import type { SoundFont, SoundFontPreset } from '../../src/infrastructure/audio/soundFont.js';

/** A database that keeps what it is given in memory, as the browser's would, and can be made to refuse. */
export class MemoryShelfDatabase implements ShelfDatabase {
  readonly kept = new Map<string, unknown>();
  refusing: string | null = null;

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.kept.get(key));
  }

  put(key: string, value: unknown): Promise<void> {
    if (this.refusing !== null) {
      return Promise.reject(new Error(this.refusing));
    }
    this.kept.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.kept.delete(key);
    return Promise.resolve();
  }
}

/** An instrument that remembers every sound it was told to take its keys from. */
export class RecordingFontInstrument implements SoundFontInstrument {
  readonly used: ({ readonly font: SoundFont; readonly preset: SoundFontPreset } | null)[] = [];

  useSoundFont(chosen: { readonly font: SoundFont; readonly preset: SoundFontPreset } | null): void {
    this.used.push(chosen);
  }

  /** The preset the keys sound from now, by name, or `null` for the built-in piano. */
  get sounding(): string | null {
    return this.used.at(-1)?.preset.name ?? null;
  }
}
