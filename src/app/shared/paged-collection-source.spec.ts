import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { PagedResult } from 'src/app/common/dao/firebase.dao';
import { BaseModel } from 'src/app/common/models/base.model';
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
});
