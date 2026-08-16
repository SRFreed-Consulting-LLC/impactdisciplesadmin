import { WritableSignal, signal } from '@angular/core';

/**
 * Ported verbatim from impact-discipleship-library-manager-new's
 * row-selection.util.ts - shared Set<string>-signal multi-select mechanics
 * (select one row, select-all-visible, prune stale ids off a live
 * snapshot). Construct one per component with `createLibraryRowSelection()`
 * and keep it as a private field; expose its `selected` signal directly
 * (same reference every call) so a template that reads
 * `selected()`/`selected().size` keeps working unchanged.
 */
export class LibraryRowSelection {
  readonly selected: WritableSignal<ReadonlySet<string>> = signal(new Set());

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggle(id: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.selected.set(next);
  }

  /** Selects (or, if every id in `visibleIds` is already selected,
   *  deselects) exactly those ids - leaves any selection outside the
   *  currently visible/filtered set untouched. */
  toggleAllVisible(visibleIds: readonly string[]): void {
    const selectAll = !this.allVisibleSelected(visibleIds);
    const next = new Set(this.selected());
    for (const id of visibleIds) {
      if (selectAll) {
        next.add(id);
      } else {
        next.delete(id);
      }
    }
    this.selected.set(next);
  }

  allVisibleSelected(visibleIds: readonly string[]): boolean {
    return visibleIds.length > 0 && visibleIds.every((id) => this.selected().has(id));
  }

  /** Call after every live-snapshot emission: drops any selected id that no
   *  longer exists in the current result set (deleted here or elsewhere). */
  pruneToLiveIds(liveIds: Iterable<string>): void {
    const live = new Set(liveIds);
    const stillSelected = new Set([...this.selected()].filter((id) => live.has(id)));
    if (stillSelected.size !== this.selected().size) {
      this.selected.set(stillSelected);
    }
  }

  clear(): void {
    this.selected.set(new Set());
  }
}

export function createLibraryRowSelection(): LibraryRowSelection {
  return new LibraryRowSelection();
}
