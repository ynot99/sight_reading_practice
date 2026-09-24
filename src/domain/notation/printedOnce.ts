import type { Exercise } from '../model/Exercise.js';
import type { IMusicXmlSerializer, PrintingOptions } from './MusicXmlSerializer.js';

/**
 * A serializer that prints each exercise once for each way of printing it.
 *
 * Opening a file printed it twice over: once to keep in the library and once
 * for the engraver, from the same exercise and the same way - the same text
 * twice. On his Alkan that is eleven million characters and some sixty
 * megabytes more of the page's memory at the moment it is fullest, which on
 * the iPad is the moment its tab closed. Asked again, this gives back the text
 * it already wrote.
 *
 * Kept against the exercise itself, and only for as long as something else
 * keeps the exercise: one is never changed once made, so the same object
 * printed the same way is the same text, and an exercise let go of takes its
 * printing with it.
 */
export class PrintedOnce implements IMusicXmlSerializer {
  private readonly printer: IMusicXmlSerializer;
  private readonly printed = new WeakMap<Exercise, Map<string, string>>();

  constructor(printer: IMusicXmlSerializer) {
    this.printer = printer;
  }

  serialize(exercise: Exercise, printing?: PrintingOptions): string {
    // Every option in the key, so one added later cannot be answered with a
    // printing made without it.
    const how = JSON.stringify(printing ?? {});
    const kept = this.printed.get(exercise) ?? new Map<string, string>();
    const known = kept.get(how);
    if (known !== undefined) {
      return known;
    }
    const text = this.printer.serialize(exercise, printing);
    kept.set(how, text);
    this.printed.set(exercise, kept);
    return text;
  }
}
