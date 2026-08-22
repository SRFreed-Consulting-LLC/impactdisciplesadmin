import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BaseModel } from '@impact-common/shared/models/base.model';
import { FirebaseDAO, QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { BaseService } from './base.service';

// TestBed as an INJECTOR only - resolves constructor params and `inject()`
// fields alike, so this survives the file's later conversion to `inject()`.
//
// BaseService is the pass-through every data service in the admin app
// extends, so its job is narrow but load-bearing: forward each call to the
// DAO with THIS service's own `table` and `fromFirestore` attached. A
// mistake here - a dropped table name, a swapped argument, a forgotten
// fromFirestore - would not fail loudly; it would quietly read or write the
// wrong collection, or hand back unconverted documents.
//
// So these tests assert the forwarding contract argument by argument. That
// is the whole behaviour of the class.

interface Thing extends BaseModel { name?: string; }

/** Records every DAO call as [method, ...args]. */
function recordingDao() {
  const calls: unknown[][] = [];
  const record = (method: string, result: unknown) => (...args: unknown[]) => {
    calls.push([method, ...args]);
    return result;
  };
  return {
    calls,
    lastCall: () => calls[calls.length - 1],
    getAll: record('getAll', Promise.resolve([])),
    getAllByValue: record('getAllByValue', Promise.resolve([])),
    queryAllByMultiValue: record('queryAllByMultiValue', Promise.resolve([])),
    getById: record('getById', Promise.resolve({})),
    getPage: record('getPage', Promise.resolve({ items: [], cursor: null, hasMore: false })),
    streamAll: record('streamAll', of([])),
    streamAllOrdered: record('streamAllOrdered', of([])),
    streamByValue: record('streamByValue', of([])),
    streamById: record('streamById', () => undefined),
    queryStreamByValue: record('queryStreamByValue', of([])),
    add: record('add', Promise.resolve({})),
    update: record('update', Promise.resolve({})),
    updateFields: record('updateFields', Promise.resolve()),
    delete: record('delete', Promise.resolve()),
  };
}

const CONVERT = (v: Thing) => v;

function setup() {
  const dao = recordingDao();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [BaseService, { provide: FirebaseDAO, useValue: dao }],
  });
  const service = TestBed.inject(BaseService) as BaseService<Thing>;
  service.table = 'things';
  service.fromFirestore = CONVERT;
  return { service, dao };
}

describe('BaseService', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('reads', () => {
    it('getAll passes the table and converter', async () => {
      const { service, dao } = setup();
      await service.getAll();
      expect(dao.lastCall()).toEqual(['getAll', 'things', CONVERT, undefined]);
    });

    it('getAll forwards an optional limit', async () => {
      const { service, dao } = setup();
      await service.getAll(25);
      expect(dao.lastCall()).toEqual(['getAll', 'things', CONVERT, 25]);
    });

    it('getAllByValue forwards field and value in order', async () => {
      const { service, dao } = setup();
      await service.getAllByValue('status', 'live');
      expect(dao.lastCall()).toEqual(['getAllByValue', 'things', 'status', 'live', CONVERT, undefined]);
    });

    it('queryAllByMultiValue forwards the query list', async () => {
      const { service, dao } = setup();
      const queries = [new QueryParam('status', WhereFilterOperandKeys.equal, 'live')];
      await service.queryAllByMultiValue(queries);
      expect(dao.lastCall()).toEqual(['queryAllByMultiValue', 'things', queries, CONVERT, undefined]);
    });

    it('getById passes the id BEFORE the table, matching the DAO signature', async () => {
      // The one method whose argument order differs from the rest - easy to
      // get backwards, and it would read a document id of "things".
      const { service, dao } = setup();
      await service.getById('abc');
      expect(dao.lastCall()).toEqual(['getById', 'abc', 'things', CONVERT]);
    });
  });

  describe('paging', () => {
    it('defaults the sort direction to ascending', async () => {
      const { service, dao } = setup();
      await service.getPage(50, null, 'name');
      expect(dao.lastCall()).toEqual(['getPage', 'things', 50, null, 'name', 'asc', undefined, CONVERT]);
    });

    it('forwards an explicit direction and filters', async () => {
      const { service, dao } = setup();
      const filters = [new QueryParam('sentAt', WhereFilterOperandKeys.notEqual, null)];
      await service.getPage(50, null, 'sentAt', 'desc', filters);
      expect(dao.lastCall()).toEqual(['getPage', 'things', 50, null, 'sentAt', 'desc', filters, CONVERT]);
    });
  });

  describe('streams', () => {
    it('streamAll forwards the error handler, so callers can tell empty from failed', () => {
      const { service, dao } = setup();
      const onError = () => undefined;
      service.streamAll(10, onError);
      expect(dao.lastCall()).toEqual(['streamAll', 'things', CONVERT, 10, onError]);
    });

    it('streamAllOrdered defaults to descending', () => {
      const { service, dao } = setup();
      service.streamAllOrdered('createdAt');
      expect(dao.lastCall()).toEqual(['streamAllOrdered', 'things', 'createdAt', 'desc', CONVERT, undefined, undefined]);
    });

    it('streamAllByValue maps onto the DAO\'s streamByValue', () => {
      // The names deliberately differ between the two layers.
      const { service, dao } = setup();
      service.streamAllByValue('status', 'live');
      expect(dao.lastCall()![0]).toBe('streamByValue');
    });

    it('streamRecord maps onto streamById and passes the callback through', () => {
      const { service, dao } = setup();
      const callback = () => undefined;
      service.streamRecord('abc', callback);
      expect(dao.lastCall()).toEqual(['streamById', 'abc', 'things', callback, CONVERT]);
    });

    it('queryStreamByValue forwards the operator', () => {
      const { service, dao } = setup();
      service.queryStreamByValue('total', WhereFilterOperandKeys.moreOrEqual, 100);
      expect(dao.lastCall()).toEqual(
        ['queryStreamByValue', 'things', 'total', '>=', 100, CONVERT, undefined, undefined]);
    });
  });

  describe('writes', () => {
    it('add passes the value, table and converter', async () => {
      const { service, dao } = setup();
      const value = { name: 'x' } as Thing;
      await service.add(value);
      expect(dao.lastCall()).toEqual(['add', value, 'things', CONVERT]);
    });

    it('update passes the id first', async () => {
      const { service, dao } = setup();
      const value = { name: 'x' } as Thing;
      await service.update('abc', value);
      expect(dao.lastCall()).toEqual(['update', 'abc', value, 'things', CONVERT]);
    });

    it('updateFields sends only the named fields, and no converter', async () => {
      // Partial update by contract - passing the converter here would be a
      // category error, since there is no whole document to convert.
      const { service, dao } = setup();
      await service.updateFields('abc', { name: 'y' });
      expect(dao.lastCall()).toEqual(['updateFields', 'abc', 'things', { name: 'y' }]);
    });

    it('delete passes the id and table only', async () => {
      const { service, dao } = setup();
      await service.delete('abc');
      expect(dao.lastCall()).toEqual(['delete', 'abc', 'things']);
    });
  });

  describe('per-service configuration', () => {
    it('uses whatever table the subclass set, not a shared one', () => {
      const { service, dao } = setup();
      service.table = 'other';
      service.getAll();
      expect(dao.lastCall()![1]).toBe('other');
    });

    it('works with no converter configured', () => {
      const { service, dao } = setup();
      service.fromFirestore = undefined;
      service.getAll();
      expect(dao.lastCall()).toEqual(['getAll', 'things', undefined, undefined]);
    });
  });
});
