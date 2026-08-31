import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { PagedResult } from 'src/app/common/dao/firebase.dao';
import { BaseModel } from '@impact-common/shared/models/base.model';
import { PagedCollectionSource } from './paged-collection-source';

interface Row extends BaseModel {
  name: string;
}

// A fake Firestore cursor - PagedCollectionSource only ever passes it back
// to the next fetchPage call, never inspects it, so a plain marker object
// duck-typed as a QueryDocumentSnapshot is all that's needed (same pattern
// as permission.service.spec.ts's duck-typed AdminAuthService).
function fakeCursor(id: string): QueryDocumentSnapshot<DocumentData> {
  return { id } as unknown as QueryDocumentSnapshot<DocumentData>;
}

function row(id: string): Row {
  return { id, name: `row-${id}` };
}

function page(items: Row[], cursor: QueryDocumentSnapshot<DocumentData> | null, hasMore: boolean): PagedResult<Row> {
  return { items, cursor, hasMore };
}

// A manually resolvable promise, so a spec can assert the mid-flight state
// of loading$/loadingMore$ before letting the fetch complete.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PagedCollectionSource', () => {
  describe('initial state', () => {
    it('starts loading with no rows and hasMore true, before any fetch', () => {
      const fetchPage = jasmine.createSpy('fetchPage');
      const source = new PagedCollectionSource<Row>(fetchPage);

      expect(source.rows$.value).toEqual([]);
      expect(source.loading$.value).toBeTrue();
      expect(source.loadingMore$.value).toBeFalse();
      expect(source.hasMore$.value).toBeTrue();
      expect(fetchPage).not.toHaveBeenCalled();
    });
  });

  describe('loadFirstPage', () => {
    it('fetches with a null cursor and the configured page size, then populates rows$', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1'), row('2')], fakeCursor('c1'), true));
      const source = new PagedCollectionSource<Row>(fetchPage, 25);

      await source.loadFirstPage();

      expect(fetchPage).toHaveBeenCalledOnceWith(25, null);
      expect(source.rows$.value).toEqual([row('1'), row('2')]);
      expect(source.hasMore$.value).toBeTrue();
    });

    it('defaults the page size to 50', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);

      await source.loadFirstPage();

      expect(fetchPage).toHaveBeenCalledOnceWith(50, null);
    });

    it('holds loading$ true while the first fetch is in flight, then drops it', async () => {
      const fetch = deferred<PagedResult<Row>>();
      const source = new PagedCollectionSource<Row>(() => fetch.promise);

      const load = source.loadFirstPage();
      expect(source.loading$.value).toBeTrue();

      fetch.resolve(page([row('1')], null, false));
      await load;

      expect(source.loading$.value).toBeFalse();
      expect(source.loadingMore$.value).toBeFalse();
    });

    it('records hasMore false when the first page is already the tail', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);

      await source.loadFirstPage();

      expect(source.hasMore$.value).toBeFalse();
    });

    it('discards previously loaded rows and restarts from a null cursor on a second call', async () => {
      const fetchPage = jasmine
        .createSpy('fetchPage')
        .and.returnValues(
          Promise.resolve(page([row('1')], fakeCursor('c1'), true)),
          Promise.resolve(page([row('2')], fakeCursor('c2'), true)),
          Promise.resolve(page([row('9')], null, false))
        );
      const source = new PagedCollectionSource<Row>(fetchPage);

      await source.loadFirstPage();
      await source.loadNextPage();
      expect(source.rows$.value).toEqual([row('1'), row('2')]);

      await source.loadFirstPage();

      expect(fetchPage.calls.mostRecent().args[1]).toBeNull();
      expect(source.rows$.value).toEqual([row('9')]);
      expect(source.hasMore$.value).toBeFalse();
    });

    it('re-arms hasMore so a refresh works even after the tail was reached', async () => {
      const fetchPage = jasmine
        .createSpy('fetchPage')
        .and.returnValues(
          Promise.resolve(page([row('1')], null, false)),
          Promise.resolve(page([row('1')], null, false))
        );
      const source = new PagedCollectionSource<Row>(fetchPage);

      await source.loadFirstPage();
      expect(source.hasMore$.value).toBeFalse();

      await source.loadFirstPage();

      expect(fetchPage).toHaveBeenCalledTimes(2);
      expect(source.rows$.value).toEqual([row('1')]);
    });
  });

  describe('loadNextPage', () => {
    it('passes the previous page\'s cursor and appends the new rows in order', async () => {
      const cursor1 = fakeCursor('c1');
      const fetchPage = jasmine
        .createSpy('fetchPage')
        .and.returnValues(
          Promise.resolve(page([row('1'), row('2')], cursor1, true)),
          Promise.resolve(page([row('3')], null, false))
        );
      const source = new PagedCollectionSource<Row>(fetchPage, 2);

      await source.loadFirstPage();
      await source.loadNextPage();

      expect(fetchPage.calls.argsFor(1)).toEqual([2, cursor1]);
      expect(source.rows$.value).toEqual([row('1'), row('2'), row('3')]);
      expect(source.hasMore$.value).toBeFalse();
    });

    it('no-ops once hasMore is false - the tail was reached', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);

      await source.loadFirstPage();
      await source.loadNextPage();
      await source.loadNextPage();

      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(source.rows$.value).toEqual([row('1')]);
    });

    it('no-ops while a load is already in flight (scroll-handler re-entrancy guard)', async () => {
      const fetch = deferred<PagedResult<Row>>();
      const fetchPage = jasmine.createSpy('fetchPage').and.returnValue(fetch.promise);
      const source = new PagedCollectionSource<Row>(fetchPage);

      const first = source.loadNextPage();
      const second = source.loadNextPage();
      await second; // resolves immediately - the guard returned without fetching

      expect(fetchPage).toHaveBeenCalledTimes(1);

      fetch.resolve(page([row('1')], null, false));
      await first;
      expect(source.rows$.value).toEqual([row('1')]);
    });

    it('raises loadingMore$ (not loading$) for a subsequent page', async () => {
      const fetches = [deferred<PagedResult<Row>>(), deferred<PagedResult<Row>>()];
      let call = 0;
      const source = new PagedCollectionSource<Row>(() => fetches[call++].promise);

      const first = source.loadFirstPage();
      fetches[0].resolve(page([row('1')], fakeCursor('c1'), true));
      await first;

      const next = source.loadNextPage();
      expect(source.loading$.value).toBeFalse();
      expect(source.loadingMore$.value).toBeTrue();

      fetches[1].resolve(page([row('2')], null, false));
      await next;

      expect(source.loadingMore$.value).toBeFalse();
    });
  });

  describe('fetch failure', () => {
    it('propagates the error but still clears the loading flags and in-flight guard', async () => {
      const fetchPage = jasmine
        .createSpy('fetchPage')
        .and.returnValues(
          Promise.reject(new Error('boom')),
          Promise.resolve(page([row('1')], null, false))
        );
      const source = new PagedCollectionSource<Row>(fetchPage);

      await expectAsync(source.loadFirstPage()).toBeRejectedWithError('boom');

      expect(source.loading$.value).toBeFalse();
      expect(source.loadingMore$.value).toBeFalse();
      expect(source.rows$.value).toEqual([]);

      // The in-flight guard was released, so a retry actually fetches again.
      await source.loadNextPage();
      expect(fetchPage).toHaveBeenCalledTimes(2);
      expect(source.rows$.value).toEqual([row('1')]);
    });
  });

  // The list -> edit -> list round trip. Screens swap the grid out with @if,
  // which unmounts it, so the offset and the loaded pages both have to
  // survive out here on the source or the admin lands back at the top.
  describe('scrollTop', () => {
    it('starts at the top', () => {
      const source = new PagedCollectionSource<Row>(jasmine.createSpy('fetchPage'));

      expect(source.scrollTop).toBe(0);
    });

    it('keeps whatever offset was written to it', () => {
      const source = new PagedCollectionSource<Row>(jasmine.createSpy('fetchPage'));

      source.scrollTop = 4200;

      expect(source.scrollTop).toBe(4200);
    });

    it('resets on loadFirstPage - the rows that offset pointed into are gone', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);
      source.scrollTop = 4200;

      await source.loadFirstPage();

      expect(source.scrollTop).toBe(0);
    });
  });

  describe('replaceRow', () => {
    it('swaps the row in place, leaving position and every other row alone', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1'), row('2'), row('3')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);
      await source.loadFirstPage();

      const updated: Row = { id: '2', name: 'renamed' };
      expect(source.replaceRow(updated)).toBeTrue();

      expect(source.rows$.value).toEqual([row('1'), updated, row('3')]);
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('emits a new array so the grid re-renders', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);
      await source.loadFirstPage();
      const before = source.rows$.value;

      source.replaceRow({ id: '1', name: 'renamed' });

      expect(source.rows$.value).not.toBe(before);
    });

    it('reports false for a row that is not loaded, and changes nothing', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);
      await source.loadFirstPage();

      expect(source.replaceRow({ id: '999', name: 'nope' })).toBeFalse();
      expect(source.rows$.value).toEqual([row('1')]);
    });
  });

  describe('removeRow', () => {
    it('drops the row without refetching', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1'), row('2')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);
      await source.loadFirstPage();

      expect(source.removeRow('1')).toBeTrue();

      expect(source.rows$.value).toEqual([row('2')]);
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('reports false for an id that is not loaded', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);
      await source.loadFirstPage();

      expect(source.removeRow('999')).toBeFalse();
      expect(source.rows$.value).toEqual([row('1')]);
    });
  });

  describe('loadAll', () => {
    // Exists for the grid's "Search all": a column filter only ever matched
    // the rows that were LOADED, so on a big collection it answered "none
    // found" about records that were simply further down.

    it('keeps paging until the collection runs out', async () => {
      const fetchPage = jasmine.createSpy('fetchPage')
        .and.returnValues(
          Promise.resolve(page([row('1')], fakeCursor('c1'), true)),
          Promise.resolve(page([row('2')], fakeCursor('c2'), true)),
          Promise.resolve(page([row('3')], null, false))
        );
      const source = new PagedCollectionSource<Row>(fetchPage);

      await source.loadAll();

      expect(fetchPage).toHaveBeenCalledTimes(3);
      expect(source.rows$.value.map((r) => r.id)).toEqual(['1', '2', '3']);
      expect(source.hasMore$.value).toBeFalse();
    });

    it('does nothing when the tail is already loaded', async () => {
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([row('1')], null, false));
      const source = new PagedCollectionSource<Row>(fetchPage);
      await source.loadFirstPage();
      fetchPage.calls.reset();

      await source.loadAll();

      expect(fetchPage).not.toHaveBeenCalled();
    });

    it('stops rather than spinning when a page adds nothing but still claims more', async () => {
      // A fetchPage that never advances its cursor would otherwise loop until
      // the tab died. The guard is why this terminates.
      const fetchPage = jasmine.createSpy('fetchPage').and.resolveTo(page([], fakeCursor('stuck'), true));
      const source = new PagedCollectionSource<Row>(fetchPage);

      await source.loadAll();

      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(source.rows$.value).toEqual([]);
    });

    it('keeps the rows it already fetched when a later page fails', async () => {
      const fetchPage = jasmine.createSpy('fetchPage')
        .and.returnValues(
          Promise.resolve(page([row('1')], fakeCursor('c1'), true)),
          Promise.reject(new Error('network'))
        );
      const source = new PagedCollectionSource<Row>(fetchPage);

      await expectAsync(source.loadAll()).toBeRejected();

      expect(source.rows$.value.map((r) => r.id))
        .withContext('a failed page must not empty the table').toEqual(['1']);
    });
  });
});
