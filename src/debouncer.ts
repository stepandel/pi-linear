/**
 * Simple timer-based debouncer that batches items by key.
 * Collects items and flushes them after `delayMs` of inactivity per key.
 */
export interface Debouncer<T> {
  enqueue(item: T): void;
  flushKey(key: string): Promise<void>;
  flushAll(): Promise<void>;
}

export function createDebouncer<T>(opts: {
  delayMs: number;
  buildKey: (item: T) => string;
  onFlush: (items: T[]) => Promise<void>;
  onError?: (err: unknown) => void;
}): Debouncer<T> {
  const pending = new Map<string, { items: T[]; timer: ReturnType<typeof setTimeout> }>();

  function scheduleFlush(key: string): void {
    const entry = pending.get(key);
    if (!entry) return;

    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void doFlush(key);
    }, opts.delayMs);
  }

  async function doFlush(key: string): Promise<void> {
    const entry = pending.get(key);
    if (!entry || entry.items.length === 0) {
      pending.delete(key);
      return;
    }

    const items = entry.items.splice(0);
    pending.delete(key);

    try {
      await opts.onFlush(items);
    } catch (err) {
      opts.onError?.(err);
    }
  }

  return {
    enqueue(item: T): void {
      const key = opts.buildKey(item);
      let entry = pending.get(key);
      if (!entry) {
        entry = { items: [], timer: setTimeout(() => {}, 0) };
        pending.set(key, entry);
      }
      entry.items.push(item);
      scheduleFlush(key);
    },

    async flushKey(key: string): Promise<void> {
      const entry = pending.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        await doFlush(key);
      }
    },

    async flushAll(): Promise<void> {
      const keys = [...pending.keys()];
      for (const key of keys) {
        const entry = pending.get(key);
        if (entry) clearTimeout(entry.timer);
        await doFlush(key);
      }
    },
  };
}
