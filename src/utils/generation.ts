/**
 * The bookkeeping state of a queued generation item (see the generator
 * store's queue).
 */
export interface IQueuedGeneration {
    gathered: boolean;
    failed: boolean;
}

/**
 * Decides whether a finished worker loop must finalize the batch itself
 * (show the collected outputs, clear the queue, stop the timers).
 *
 * A batch finalizes when every item is done and at least one failed (the
 * all-success case is finalized inside processImages as the last output
 * lands), or when the user cancelled: a cancelled batch never reaches the
 * "every item done" state (the pending items are abandoned), so it must be
 * finalized even with items still pending — otherwise the collected outputs
 * are never shown (the generation screen renders no carousel and no canvas).
 */
export function batchShouldFinalize(cancelled: boolean, queue: IQueuedGeneration[]): boolean {
    return cancelled
        || (queue.some(el => el.failed)
            && queue.every(el => el.gathered || el.failed));
}
