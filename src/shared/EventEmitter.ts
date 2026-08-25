/** Handle returned by every subscription API in this code base. */
export type Unsubscribe = () => void;

export type Listener<TPayload> = (payload: TPayload) => void;

/**
 * Read-only view of an emitter, handed to collaborators that may observe but
 * must not publish.
 */
export interface IEventSource<TEvents extends object> {
  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): Unsubscribe;
  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): Unsubscribe;
  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void;
}

/**
 * Minimal, strongly typed publish/subscribe bus.
 *
 * Nothing in the domain or application layer depends on DOM events, so the
 * whole practice loop stays observable from plain Node test code.
 */
export class TypedEventEmitter<TEvents extends object> implements IEventSource<TEvents> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<never>>>();

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): Unsubscribe {
    let bucket = this.listeners.get(event);
    if (bucket === undefined) {
      bucket = new Set<Listener<never>>();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener as Listener<never>);
    return () => {
      this.off(event, listener);
    };
  }

  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    const bucket = this.listeners.get(event);
    if (bucket === undefined) {
      return;
    }
    bucket.delete(listener as Listener<never>);
    if (bucket.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const bucket = this.listeners.get(event);
    if (bucket === undefined) {
      return;
    }
    // Snapshot: listeners are allowed to subscribe/unsubscribe during dispatch.
    for (const listener of [...bucket]) {
      (listener as Listener<TEvents[K]>)(payload);
    }
  }

  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  asSource(): IEventSource<TEvents> {
    return this;
  }
}
