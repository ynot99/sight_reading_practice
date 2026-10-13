import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../shared/EventEmitter.js';
import type { PerformanceRecorder, Take } from './PerformanceRecorder.js';
import type { StoredTake, TakeLibrary } from './TakeLibrary.js';

/** What the take on offer publishes. */
export interface TakeOnOfferEventMap {
  /** A take went onto the list, on either shelf. */
  filed: { readonly take: StoredTake };
}

/**
 * The take the keep button offers, and the list it goes into.
 *
 * A take that has ended is filed on the recent shelf at once, and stays on
 * offer: the button goes on showing it, and pressing it moves that same take
 * to the kept shelf rather than filing a second copy. It used to be filed only
 * when the next key was pressed, so a reader who played an idea and then
 * closed the page, or reloaded it, lost the idea - the last thing played is
 * the one most likely to be the one worth having.
 *
 * Ended means sealed by the silence that ends a take. The recorder keeps no
 * clock of its own, so the page, which counts that silence out for the
 * button, says when it has run out; a take the page never said so of is filed
 * when the next one begins, as every take used to be.
 */
export class TakeOnOffer {
  private readonly recorder: PerformanceRecorder;
  private readonly takes: TakeLibrary;
  private readonly now: () => number;
  private readonly emitter = new TypedEventEmitter<TakeOnOfferEventMap>();
  private readonly closing: Unsubscribe;
  /**
   * The name the take on offer is on the list under, once it is. Let go of
   * when the next take begins, which the recorder always says before it
   * offers that one.
   */
  private filed: string | null = null;

  /** `now` is the calendar, for when a take was filed; the recorder's clock measures music. */
  constructor(recorder: PerformanceRecorder, takes: TakeLibrary, now: () => number) {
    this.recorder = recorder;
    this.takes = takes;
    this.now = now;
    this.closing = recorder.events.on('takeClosed', ({ take }) => {
      // Still the take on offer: the recorder closes one before it hears the
      // event that begins the next.
      if (this.alreadyFiled() === null) {
        this.file(take, 'recent');
      }
      this.filed = null;
    });
  }

  get events(): IEventSource<TakeOnOfferEventMap> {
    return this.emitter.asSource();
  }

  /** Whether the take on offer is on the list already. */
  get isFiled(): boolean {
    return this.alreadyFiled() !== null;
  }

  /**
   * Files the take on offer on the recent shelf, once the silence has ended
   * it - and only once. Says what it filed, or `null`.
   */
  fileItIfItHasEnded(): StoredTake | null {
    if (!this.recorder.takeIsSealed || this.alreadyFiled() !== null) {
      return null;
    }
    const take = this.recorder.take();
    if (take === null) {
      return null;
    }
    const stored = this.file(take, 'recent');
    this.filed = stored.id;
    return stored;
  }

  /**
   * Keeps the take on offer for good: the one on the list already, moved to
   * the kept shelf, or - still being played - filed there as it stands.
   *
   * Either way it is let go of afterwards, so the next press cannot keep it a
   * second time.
   */
  keep(): StoredTake | null {
    const filed = this.alreadyFiled();
    let kept: StoredTake | null;
    if (filed !== null) {
      kept = this.takes.setShelf(filed, 'kept');
    } else {
      const take = this.recorder.take();
      kept = take === null ? null : this.file(take, 'kept');
    }
    if (kept !== null) {
      this.recorder.clear();
      this.filed = null;
    }
    return kept;
  }

  /** Releases the recorder. */
  dispose(): void {
    this.closing();
    this.emitter.removeAllListeners();
  }

  /**
   * The name the take on offer is on the list under, or `null`. A take the
   * reader has since deleted from the list is not on it.
   */
  private alreadyFiled(): string | null {
    const filed = this.filed;
    return filed === null || this.takes.find(filed) === null ? null : filed;
  }

  private file(take: Take, shelf: 'recent' | 'kept'): StoredTake {
    const stored = this.takes.file(take, this.now(), shelf);
    this.emitter.emit('filed', { take: stored });
    return stored;
  }
}
