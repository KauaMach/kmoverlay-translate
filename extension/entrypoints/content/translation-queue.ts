interface QueueEntry {
  visible: boolean;
  order: number;
}

/**
 * Images waiting for the server. Images on screen go first; among the rest,
 * the page order decides, so prefetching follows the reading.
 */
export class TranslationQueue<Key> {
  private readonly entries = new Map<Key, QueueEntry>();

  /** Adds an item, or updates it when it is already waiting. `order` is its position on the page. */
  add(key: Key, visible: boolean, order: number): void {
    this.entries.set(key, { visible, order });
  }

  /** Moves an item ahead of (or back behind) the images off screen. */
  setVisible(key: Key, visible: boolean): void {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      entry.visible = visible;
    }
  }

  remove(key: Key): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  has(key: Key): boolean {
    return this.entries.has(key);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Items in the order they will be sent. */
  ordered(): Key[] {
    return [...this.entries.entries()]
      .sort(([, a], [, b]) => Number(b.visible) - Number(a.visible) || a.order - b.order)
      .map(([key]) => key);
  }

  /** Removes and returns the next item to send. */
  takeNext(): Key | undefined {
    const [next] = this.ordered();
    if (next !== undefined) {
      this.entries.delete(next);
    }
    return next;
  }

  /** 1-based position of an item ("Na fila · 3ª"), or `null` when it is not waiting. */
  position(key: Key): number | null {
    const index = this.ordered().indexOf(key);
    return index === -1 ? null : index + 1;
  }
}
