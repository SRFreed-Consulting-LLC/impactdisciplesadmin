import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { CheckoutForm, FulfillmentStatus } from '@impact-common/shared/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { QueryParam } from 'src/app/common/dao/firebase.dao';
import { PurchaseReportComponent } from './purchase-report.component';

// TestBed is used purely as an INJECTOR here - the class is registered as a
// provider and Angular constructs it. No compileComponents(), no
// createComponent(), so no template renders and none of this component's
// module imports are needed.
//
// This shape is deliberate: it resolves CONSTRUCTOR parameters and runs
// `inject()` field initializers alike, so it keeps working unchanged when
// this file is converted to `inject()` (the direction all three apps are
// moving). A spec written as `new PurchaseReportComponent(fake, fb)` would
// have to be rewritten on the day of that conversion.

/** Records the queries the report actually issues, and replays canned rows. */
function fakePurchasesService(rows: CheckoutForm[] = [], failWith?: Error) {
  const calls: QueryParam[][] = [];
  return {
    calls,
    queryAllByMultiValue: (params: QueryParam[]) => {
      calls.push(params);
      return failWith ? Promise.reject(failWith) : Promise.resolve(rows);
    },
  };
}

function makeComponent(service: ReturnType<typeof fakePurchasesService>): PurchaseReportComponent {
  TestBed.configureTestingModule({
    providers: [
      PurchaseReportComponent,
      FormBuilder,
      { provide: PurchasesService, useValue: service },
    ],
  });
  return TestBed.inject(PurchaseReportComponent);
}

function purchase(overrides: Partial<CheckoutForm> = {}): CheckoutForm {
  return {
    id: 'p1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    total: 42,
    ...overrides,
  } as CheckoutForm;
}

describe('PurchaseReportComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('canGenerate', () => {
    it('is false until at least one criterion is switched on', () => {
      // Otherwise the report would query the entire purchases collection.
      const component = makeComponent(fakePurchasesService());
      expect(component.canGenerate).toBeFalsy();
    });

    it('is true with either criterion enabled', () => {
      const byDate = makeComponent(fakePurchasesService());
      byDate.criteriaForm.patchValue({ dateEnabled: true });
      expect(byDate.canGenerate).toBeTruthy();

      TestBed.resetTestingModule();
      const byState = makeComponent(fakePurchasesService());
      byState.criteriaForm.patchValue({ stateEnabled: true });
      expect(byState.canGenerate).toBeTruthy();
    });
  });

  describe('columns', () => {
    it('displays only the visible ones, in order', () => {
      const component = makeComponent(fakePurchasesService());
      const firstKey = component.columns[0].key;
      expect(component.displayedColumns).toContain(firstKey);

      component.toggleColumn(component.columns[0]);
      expect(component.displayedColumns).not.toContain(firstKey);
    });

    it('toggles a column back on again', () => {
      const component = makeComponent(fakePurchasesService());
      const column = component.columns[0];
      component.toggleColumn(column);
      component.toggleColumn(column);
      expect(component.displayedColumns).toContain(column.key);
    });

    it('labels a known key, and falls back to the key itself for an unknown one', () => {
      const component = makeComponent(fakePurchasesService());
      const known = component.columns[0];
      expect(component.columnLabel(known.key)).toBe(known.label);
      expect(component.columnLabel('nope')).toBe('nope');
    });
  });

  describe('generateReport', () => {
    it('refuses to run with no criteria, and issues no query', async () => {
      const service = fakePurchasesService([purchase()]);
      const component = makeComponent(service);
      await component.generateReport();
      expect(service.calls.length).toBe(0);
      expect(component.generated).toBeFalse();
    });

    it('maps results into report rows', async () => {
      const service = fakePurchasesService([purchase()]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ dateEnabled: true, dateMode: 'after', afterDate: new Date('2026-01-01') });

      await component.generateReport();

      expect(component.generated).toBeTrue();
      expect(component.results.length).toBe(1);
      expect(component.results[0].firstName).toBe('Ada');
      expect(component.results[0].total).toBe(42);
    });

    it('clears the loading flag whether it succeeds or fails', async () => {
      const ok = makeComponent(fakePurchasesService([purchase()]));
      ok.criteriaForm.patchValue({ dateEnabled: true });
      await ok.generateReport();
      expect(ok.loading).toBeFalse();

      TestBed.resetTestingModule();
      const bad = makeComponent(fakePurchasesService([], new Error('boom')));
      bad.criteriaForm.patchValue({ dateEnabled: true });
      await bad.generateReport();
      expect(bad.loading).toBeFalse();
    });

    it('surfaces a query failure distinctly from an empty result', async () => {
      // Firestore's "query requires an index" error is the one that matters:
      // without this, a missing composite index looks exactly like "no
      // purchases matched".
      const component = makeComponent(fakePurchasesService([], new Error('The query requires an index.')));
      component.criteriaForm.patchValue({ dateEnabled: true });

      await component.generateReport();

      expect(component.errorMessage).toBe('The query requires an index.');
      expect(component.generated).toBeFalse();
    });
  });

  describe('date criteria', () => {
    const paramsOf = async (patch: Record<string, unknown>) => {
      const service = fakePurchasesService([]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ dateEnabled: true, ...patch });
      await component.generateReport();
      return service.calls[0];
    };

    it('after: one lower-bound constraint', async () => {
      const params = await paramsOf({ dateMode: 'after', afterDate: new Date('2026-01-01') });
      expect(params.length).toBe(1);
      expect(params[0].field).toBe('dateProcessed');
      expect(params[0].operation).toBe('>=');
    });

    it('between: a lower and an upper bound', async () => {
      const params = await paramsOf({
        dateMode: 'between',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-02-01'),
      });
      expect(params.map((p) => String(p.operation)).sort()).toEqual(['<=', '>=']);
    });

    it('lastMonths: a lower bound that many months back', async () => {
      const params = await paramsOf({ dateMode: 'lastMonths', lastMonths: 3 });
      expect(params.length).toBe(1);
      expect(params[0].operation).toBe('>=');

      const since = params[0].value as Date;
      const expected = new Date();
      expected.setMonth(expected.getMonth() - 3);
      // Same month, allowing for the clock ticking mid-test.
      expect(since.getMonth()).toBe(expected.getMonth());
    });

    it('treats a missing lastMonths as zero rather than producing an invalid date', async () => {
      const params = await paramsOf({ dateMode: 'lastMonths', lastMonths: null });
      expect(isNaN((params[0].value as Date).getTime())).toBeFalse();
    });

    it('issues no date constraints when the date criterion is off', async () => {
      const service = fakePurchasesService([]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ stateEnabled: true, state: 'TX' });
      await component.generateReport();
      // State-only: two queries (billing + shipping), neither date-bounded.
      expect(service.calls.every((c) => c.every((p) => p.field !== 'dateProcessed'))).toBeTrue();
    });
  });

  describe('state criterion', () => {
    it('queries billing AND shipping, since either may carry the state', async () => {
      const service = fakePurchasesService([]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ stateEnabled: true, state: 'TX' });

      await component.generateReport();

      const fields = service.calls.flat().map((p) => p.field);
      expect(fields).toContain('billingAddress.state');
      expect(fields).toContain('shippingAddress.state');
    });

    it('queries BOTH spellings of the state, code and full name', async () => {
      // Two fields x two spellings = 4 queries. The spellings matter because
      // the picker offers full names while the data is largely 2-letter
      // codes - "Texas" alone used to miss every record stored as "TX".
      const service = fakePurchasesService([]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ stateEnabled: true, state: 'TX' });

      await component.generateReport();

      expect(service.calls.length).toBe(4);
      const stateValues = service.calls
        .flat()
        .filter((p) => p.field.endsWith('.state'))
        .map((p) => p.value);
      expect(stateValues).toContain('TX');
      expect(stateValues).toContain('Texas');
    });

    it('counts a purchase matching both addresses only once', async () => {
      // Both queries return the same doc; without the id-keyed dedupe the
      // report would double-count it and every total would be wrong.
      const service = fakePurchasesService([purchase({ id: 'same' })]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ stateEnabled: true, state: 'TX' });

      await component.generateReport();

      expect(component.results.length).toBe(1);
    });
  });

  describe('row mapping', () => {
    it('blanks missing fields instead of printing undefined', async () => {
      const service = fakePurchasesService([{ id: 'bare' } as CheckoutForm]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ dateEnabled: true });

      await component.generateReport();

      const row = component.results[0];
      expect(row.firstName).toBe('');
      expect(row.email).toBe('');
      expect(row.billingCity).toBe('');
      expect(row.itemsPurchased).toBe('');
      expect(row.total).toBe(0);
    });

    it('joins the purchased item names, skipping blanks', async () => {
      const service = fakePurchasesService([
        purchase({ cartItems: [{ itemName: 'Field Guide' }, { itemName: '' }, { itemName: 'Tee' }] as never }),
      ]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ dateEnabled: true });

      await component.generateReport();

      expect(component.results[0].itemsPurchased).toBe('Field Guide, Tee');
    });

    it('labels a known fulfillment status, and Unknown for anything else', async () => {
      const service = fakePurchasesService([
        purchase({ id: 'a', fulfillmentStatus: undefined }),
        purchase({ id: 'b', fulfillmentStatus: 'not-a-real-status' as unknown as FulfillmentStatus }),
      ]);
      const component = makeComponent(service);
      component.criteriaForm.patchValue({ dateEnabled: true });

      await component.generateReport();

      expect(component.results.every((r) => typeof r.fulfillmentStatusLabel === 'string')).toBeTrue();
      expect(component.results[1].fulfillmentStatusLabel).toBe('Unknown');
    });
  });
});
