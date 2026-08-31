import { BehaviorSubject } from 'rxjs';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { PagedResult } from 'src/app/common/dao/firebase.dao';
import { BaseModel } from '@impact-common/shared/models/base.model';

/** How many rows loadAll() asks for per round trip - see its own comment.
 *  Well inside Firestore's limits, and 10x fewer requests than browsing. */
const BULK_PAGE_SIZE = 500;

// Client-side accumulator driving "infinite scroll" over BaseService.getPage()
// - a one-time (not live) fetch per batch, unlike streamAll()'s "subscribe to
// the entire collection forever". Used by list screens on large collections
// (Products, Customers, Log Messages) instead of streamAll().
//
// Trade-off, by design (see the "Live updates"/"Filter behavior" decisions
// this was built for): rows already loaded do NOT update live if someone
// else edits/adds a record elsewhere - only a fresh loadFirstPage() (e.g. a
// manual refresh) picks that up. And any client-side filtering a component
// layers on top of rows$ can only ever search what's been loaded so far,
// not the whole collection - scrolling further extends what's filterable.
export class PagedCollectionSource<T extends BaseModel> {
  /** Every row loaded so far, oldest page first. */
  readonly rows$ = new BehaviorSubject<T[]>([]);
  /** True only until the first page has arrived - drives the same full-table
   *  loading overlay every other list screen already uses. */
  readonly loading$ = new BehaviorSubject<boolean>(true);
  /** True while a subsequent page is in flight - drives a small inline
   *  "loading more" indicator instead of the full-table overlay. */
  readonly loadingMore$ = new BehaviorSubject<boolean>(false);
  /** False once a page comes back with fewer than pageSize rows - the
   *  collection's actual tail, not just "nothing loaded this call". */
  readonly hasMore$ = new BehaviorSubject<boolean>(true);

  /** Scroll offset (px) of the grid rendering this source, remembered
   *  across a list -> edit -> list round trip. Screens switch to an edit
   *  view with @if, which UNMOUNTS the grid and takes its scroll position
   *  with it; this source lives on the screen component, which survives
   *  that, so it is the one place the offset can be kept. Written by
   *  DataGridComponent on scroll, read back by it on re-mount. */
  scrollTop = 0;

  private cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  private loadingInFlight = false;

  constructor(
    private fetchPage: (pageSize: number, cursor: QueryDocumentSnapshot<DocumentData> | null) => Promise<PagedResult<T>>,
    private pageSize = 50
  ) {}

  /** Discards whatever's loaded and starts over from the beginning. */
  async loadFirstPage(): Promise<void> {
    // A real reload starts at the top - restoring an offset into rows that
    // no longer exist would land somewhere arbitrary.
    this.scrollTop = 0;
    this.cursor = null;
    this.rows$.next([]);
    this.hasMore$.next(true);
    this.loading$.next(true);
    await this.loadNextPage();
  }

  /** No-ops if a load is already in flight or the collection's tail was
   *  already reached - safe to call from a scroll handler without its own
   *  debounce/guard logic. */
  async loadNextPage(): Promise<void> {
    if (this.loadingInFlight || !this.hasMore$.value) {
      return;
    }

    this.loadingInFlight = true;
    this.loadingMore$.next(true);

    try {
      const result = await this.fetchPage(this.pageSize, this.cursor);
      this.cursor = result.cursor;
      this.hasMore$.next(result.hasMore);
      this.rows$.next([...this.rows$.value, ...result.items]);
    } finally {
      this.loadingInFlight = false;
      this.loading$.next(false);
      this.loadingMore$.next(false);
    }
  }

  /**
   * Pages to the end of the collection, deliberately and on demand.
   *
   * WHY THIS EXISTS. The column filters run over the rows that are LOADED, so
   * on a big collection a filter answers "none found" for records that are
   * simply further down - which reads as "this person is not in the system"
   * and is how a duplicate contact gets created. The grid offers this behind
   * a button once a filter is active and pages remain; see data-grid's
   * searchAll().
   *
   * NEVER call it automatically. Paging exists because these collections are
   * thousands of rows; this is the escape hatch for a search, not a default.
   *
   * `loadingMore$` stays true for the whole run, so the grid can say what is
   * happening, and a page that fails leaves the rows already fetched in
   * place rather than emptying the table.
   */
  async loadAll(): Promise<void> {
    // BIGGER PAGES, deliberately. Scrolling wants small pages - they arrive
    // fast and the reader is only ever looking at a screenful. A search wants
    // the opposite: at the browsing size, 5,450 contacts took 109 round trips
    // and 27 seconds, which is long enough that staff would assume it had
    // hung. The page size is a scrolling decision, not a fetching limit.
    const browsingSize = this.pageSize;
    this.pageSize = Math.max(this.pageSize, BULK_PAGE_SIZE);
    try {
      // Bounded: a fetchPage that always claimed hasMore without advancing
      // its cursor would otherwise spin forever.
      for (let guard = 0; guard < 400 && this.hasMore$.value; guard++) {
        const before = this.rows$.value.length;
        await this.loadNextPage();
        if (this.rows$.value.length === before) {
          break;
        }
      }
    } finally {
      // Restored even on a failed page: the next scroll must go back to
      // arriving a screenful at a time.
      this.pageSize = browsingSize;
    }
  }

  /**
   * Swaps one already-loaded row for a fresher copy, in place, leaving every
   * other loaded page untouched.
   *
   * This is what a screen wants after editing a single record. The obvious
   * alternative - loadFirstPage() - discards EVERY loaded row (its first act
   * is rows$.next([])), so an admin who scrolled to row 400 to find someone
   * came back to a 50-row list scrolled to the top. Refetching the one
   * document is also a single read instead of fifty.
   *
   * Returns false when that id is not currently loaded - nothing on screen
   * to update, and the caller can ignore it.
   */
  replaceRow(row: T): boolean {
    const rows = this.rows$.value;
    const index = rows.findIndex((r) => r.id === row.id);
    if (index === -1) {
      return false;
    }
    const next = [...rows];
    next[index] = row;
    this.rows$.next(next);
    return true;
  }

  /**
   * Drops one row from what is loaded - the deleted-while-editing case.
   * Deliberately does NOT refetch to backfill the gap: the cursor still
   * points where it did, so the next scroll-triggered page arrives normally
   * and the list is one row short until then. Invisible in a list of
   * thousands, and it costs nothing.
   */
  removeRow(id: string): boolean {
    const rows = this.rows$.value;
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) {
      return false;
    }
    this.rows$.next(next);
    return true;
  }
}
