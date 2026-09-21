export interface WorldWakeChange {
  readonly sourceId: string;
  readonly dirtyKeys?: readonly string[];
  readonly mustHandleId?: string;
  readonly requiresRescan?: boolean;
}

export interface CoalescedWake {
  readonly generation: number;
  readonly sourceIds: readonly string[];
  readonly dirtyKeys: readonly string[];
  readonly mustHandleIds: readonly string[];
  /** Durable pending rows exist beyond the in-memory page. */
  readonly mustHandleBackpressure: boolean;
  readonly rescanRequired: boolean;
}

export class MustHandlePersistenceError extends Error {
  constructor() {
    super("must-handle wake requires a durable ledger callback before coalescing");
    this.name = "MustHandlePersistenceError";
  }
}

export class BoundedWakeCoalescer {
  private readonly sourceIds = new Map<string, number>();
  private readonly dirtyKeys = new Map<string, number>();
  private readonly mustHandleIds = new Map<string, number>();
  private readonly overflowMustHandleIds = new Set<string>();
  private rescanGeneration: number | undefined;
  private generation = 0;
  private readonly limits: {
    readonly maxSourceIds: number;
    readonly maxDirtyKeys: number;
    readonly maxMustHandleIds: number;
  };
  private readonly persistMustHandleId?: (sourceId: string) => void;

  constructor(
    limits: {
      readonly maxSourceIds: number;
      readonly maxDirtyKeys: number;
      readonly maxMustHandleIds: number;
    } = { maxSourceIds: 256, maxDirtyKeys: 512, maxMustHandleIds: 128 },
    persistMustHandleId?: (sourceId: string) => void,
  ) {
    this.limits = limits;
    this.persistMustHandleId = persistMustHandleId;
  }

  enqueue(change: WorldWakeChange): void {
    const generation = ++this.generation;
    if (this.sourceIds.size < this.limits.maxSourceIds || this.sourceIds.has(change.sourceId)) this.sourceIds.set(change.sourceId, generation);
    else this.rescanGeneration = generation;
    for (const key of change.dirtyKeys ?? []) {
      if (this.dirtyKeys.size < this.limits.maxDirtyKeys || this.dirtyKeys.has(key)) this.dirtyKeys.set(key, generation);
      else this.rescanGeneration = generation;
    }
    if (change.mustHandleId !== undefined) {
      if (this.persistMustHandleId === undefined) throw new MustHandlePersistenceError();
      // This must happen before the id is admitted to the bounded in-memory page.
      this.persistMustHandleId(change.mustHandleId);
      if (this.mustHandleIds.has(change.mustHandleId)) {
        this.mustHandleIds.set(change.mustHandleId, generation);
      } else if (this.mustHandleIds.size < this.limits.maxMustHandleIds) {
        this.mustHandleIds.set(change.mustHandleId, generation);
      } else {
        this.overflowMustHandleIds.add(change.mustHandleId);
      }
    }
    if (change.requiresRescan === true) this.rescanGeneration = generation;
  }

  get pending(): boolean {
    return (
      this.sourceIds.size > 0 ||
      this.dirtyKeys.size > 0 ||
      this.mustHandleIds.size > 0 ||
      this.overflowMustHandleIds.size > 0 ||
      this.rescanGeneration !== undefined
    );
  }

  /** Read the bounded in-memory page without acknowledging or discarding it. */
  snapshot(): CoalescedWake | undefined {
    if (!this.pending) return undefined;
    return {
      generation: this.generation,
      sourceIds: [...this.sourceIds.keys()],
      dirtyKeys: [...this.dirtyKeys.keys()],
      mustHandleIds: [...this.mustHandleIds.keys()],
      mustHandleBackpressure: this.overflowMustHandleIds.size > 0,
      rescanRequired: this.rescanGeneration !== undefined,
    };
  }

  /** Clear only replaceable work observed by a pinned context generation. */
  acknowledgeReplaceable(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError("invalid coalescer generation");
    for (const [key, itemGeneration] of this.sourceIds) if (itemGeneration <= generation) this.sourceIds.delete(key);
    for (const [key, itemGeneration] of this.dirtyKeys) if (itemGeneration <= generation) this.dirtyKeys.delete(key);
    if (this.rescanGeneration !== undefined && this.rescanGeneration <= generation) this.rescanGeneration = undefined;
  }

  acknowledgeMustHandle(sourceId: string): void {
    this.mustHandleIds.delete(sourceId);
    this.overflowMustHandleIds.delete(sourceId);
  }

  drain(): CoalescedWake | undefined {
    const batch = this.snapshot();
    if (batch === undefined) return undefined;
    this.sourceIds.clear();
    this.dirtyKeys.clear();
    this.mustHandleIds.clear();
    this.overflowMustHandleIds.clear();
    this.rescanGeneration = undefined;
    return batch;
  }
}
