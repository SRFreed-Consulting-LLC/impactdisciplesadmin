import { BehaviorSubject } from 'rxjs';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { PagedResult } from 'src/app/common/dao/firebase.dao';
import { BaseModel } from 'src/app/common/models/base.model';

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

  private cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  private loadingInFlight = false;

  constructor(
    private fetchPage: (pageSize: number, cursor: QueryDocumentSnapshot<DocumentData> | null) => Promise<PagedResult<T>>,
    private pageSize = 50
  ) {}

  /** Discards whatever's loaded and starts over from the beginning. */
  async loadFirstPage(): Promise<void> {
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
}
