import { TestBed } from '@angular/core/testing';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { ContactReportComponent } from './contact-report.component';

// This report is a flatten + a sort + a failure path, and that is all it is
// - filtering, sorting by header, the Columns menu and the Excel export all
// belong to <app-data-grid> and are covered by its own specs. What is worth
// pinning is what the 2026-09-04 rebuild changed or could silently regress:
//
//  - it loads EVERY contact with no criteria, because an empty resting
//    state behind a Generate button is the thing that was removed;
//  - a contact with no last name sorts last, not first, so the list does
//    not open on a run of blanks;
//  - a failed load must not render as "No contacts found." - the grid's
//    empty message over a set that was never fetched is a lie about the
//    data, and it is the reason `errorMessage` exists separately.
//
// TestBed-as-injector (no compileComponents): the component takes its
// service through inject(), so `new`-ing it here would throw NG0203.
describe('ContactReportComponent', () => {
  let component: ContactReportComponent;

  const aContact = (extra: Partial<ContactModel> = {}): ContactModel =>
    ({
      id: 'c-1',
      firstName: 'Pat',
      lastName: 'Patron',
      email: 'pat@test.local',
      ...extra
    }) as ContactModel;

  function configure(getAll: () => Promise<ContactModel[]>): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ContactReportComponent,
        { provide: ContactService, useValue: { getAll } }
      ]
    });
    component = TestBed.inject(ContactReportComponent);
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

  it('loads every contact with no criteria to choose first', async () => {
    configure(() => Promise.resolve([
      aContact({ id: 'c-1', lastName: 'Zeta' }),
      aContact({ id: 'c-2', lastName: 'Alpha' })
    ]));
    await flush();

    expect(component.rows().length).toBe(2);
    expect(component.totalCount()).toBe(2);
    expect(component.loading()).toBeFalse();
    expect(component.errorMessage()).toBe('');
  });

  it('sorts by surname, then first name', async () => {
    configure(() => Promise.resolve([
      aContact({ id: 'c-1', lastName: 'Smith', firstName: 'Bea' }),
      aContact({ id: 'c-2', lastName: 'Adams', firstName: 'Cass' }),
      aContact({ id: 'c-3', lastName: 'Smith', firstName: 'Al' })
    ]));
    await flush();

    expect(component.rows().map((r) => `${r.lastName} ${r.firstName}`))
      .toEqual(['Adams Cass', 'Smith Al', 'Smith Bea']);
  });

  // A blank surname at the TOP is what an unguarded localeCompare gives,
  // and it puts the least identifiable rows in the first screenful.
  it('sorts a contact with no last name to the end', async () => {
    configure(() => Promise.resolve([
      aContact({ id: 'c-1', lastName: '', firstName: 'Nameless' }),
      aContact({ id: 'c-2', lastName: 'Adams', firstName: 'Cass' })
    ]));
    await flush();

    expect(component.rows().map((r) => r.firstName)).toEqual(['Cass', 'Nameless']);
  });

  it('flattens the nested address and phone fields it reports on', async () => {
    configure(() => Promise.resolve([aContact({
      phone: { number: '555-0100' },
      billingAddress: { address1: '1 Main St', city: 'Atlanta', state: 'GA', zip: '30301' },
      pendingChanges: [{}, {}]
    } as Partial<ContactModel>)]));
    await flush();

    const row = component.rows()[0];
    expect(row.phone).toBe('555-0100');
    expect(row.billingCity).toBe('Atlanta');
    expect(row.billingState).toBe('GA');
    expect(row.pendingChangesCount).toBe(2);
    // Absent optional fields report as blank, never as "undefined" - the
    // spreadsheet gets a real empty cell.
    expect(row.shippingCity).toBe('');
  });

  it('reports a failed load as an error rather than as an empty list', async () => {
    configure(() => Promise.reject(new Error('offline')));
    await flush();

    expect(component.rows()).toEqual([]);
    expect(component.errorMessage()).toContain('offline');
    expect(component.loading()).toBeFalse();
  });
});
