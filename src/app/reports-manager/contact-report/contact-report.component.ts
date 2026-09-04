import { Component, computed, inject, signal } from '@angular/core';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

// Flat, report-specific row shape - not ContactModel itself, same
// convention as the Purchase report's own ReportRow.
export interface ContactReportRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  billingAddress1: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  shippingAddress1: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  pendingChangesCount: number;
}

// Reports Manager > Contacts - every contact, in one list, exportable.
//
// REBUILT 2026-09-04 (owner: "I really just want them to see a list of all
// the contacts"). It used to be a criteria form gating a State query behind
// a Generate Report button, which meant the screen's resting state was an
// empty page and a hint telling you to pick something - you could not
// answer "how many contacts do we have" without first choosing a state.
// There was never a date criterion to remove: ContactModel has no
// signup/created date at all (customer docs are upserted from purchases and
// event registrations - see functions/src/customer-upsert.functions.ts -
// with no timestamp stamped anywhere), which is also why one cannot simply
// be added back.
//
// The State criterion went with it, and this is NOT a loss of function: the
// grid's own filter row filters any column, including both state columns,
// and it does it without a round trip. The old query existed because
// Firestore cannot OR across billingAddress.state and shippingAddress.state
// in one go, so the screen ran two queries and deduped by id; filtering a
// list already in memory has no such problem. It also stops depending on
// stateVariants() to paper over "GA" vs "Georgia" - that split is being
// normalized to 2-letter codes in the data itself
// (scripts/normalize-address-codes.js).
//
// COST, stated plainly: this reads the whole `customers` collection on open
// - 5,617 documents on production. That is deliberate for a REPORT, whose
// job is to be exported whole, and it matches what the Digital Book Users
// report already does. It is NOT the pattern for a list SCREEN; Contacts
// under contacts-manager stays on PagedCollectionSource for exactly that
// reason.
@Component({
    selector: 'app-contact-report',
    templateUrl: './contact-report.component.html',
    styleUrls: ['./contact-report.component.scss'],
    standalone: false
})
export class ContactReportComponent {
  private readonly service = inject(ContactService);

  // The grid owns filtering, sorting, the Columns menu and the Excel export
  // (same call the old hand-rolled header made, over the FILTERED rows), so
  // this report carries no ReportColumnSet of its own. The four
  // criteria-form reports still do - see report-column-set.ts.
  readonly columns: DataGridColumn<ContactReportRow>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'billingAddress1', label: 'Billing Address', visible: false },
    { key: 'billingCity', label: 'Billing City', visible: false },
    { key: 'billingState', label: 'Billing State' },
    { key: 'billingZip', label: 'Billing Zip', visible: false },
    { key: 'shippingAddress1', label: 'Shipping Address', visible: false },
    { key: 'shippingCity', label: 'Shipping City', visible: false },
    { key: 'shippingState', label: 'Shipping State', visible: false },
    { key: 'shippingZip', label: 'Shipping Zip', visible: false },
    { key: 'pendingChangesCount', label: 'Pending Review', type: 'number' }
  ];

  readonly rows = signal<ContactReportRow[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  readonly totalCount = computed(() => this.rows().length);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const contacts = await this.service.getAll();
      this.rows.set((contacts ?? []).map((item) => this.toRow(item)).sort(byLastThenFirst));
    } catch (err) {
      // A failed load must not read as "there are no contacts" - the grid
      // would otherwise show its empty message over a set it never got.
      this.errorMessage.set(
        'Could not load contacts. ' + ((err as { message?: string })?.message ?? 'Please try again.')
      );
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private toRow(item: ContactModel): ContactReportRow {
    return {
      id: item.id!,
      firstName: item.firstName ?? '',
      lastName: item.lastName ?? '',
      email: item.email ?? '',
      phone: item.phone?.number ?? '',
      billingAddress1: item.billingAddress?.address1 ?? '',
      billingCity: item.billingAddress?.city ?? '',
      billingState: item.billingAddress?.state ?? '',
      billingZip: item.billingAddress?.zip ?? '',
      shippingAddress1: item.shippingAddress?.address1 ?? '',
      shippingCity: item.shippingAddress?.city ?? '',
      shippingState: item.shippingAddress?.state ?? '',
      shippingZip: item.shippingAddress?.zip ?? '',
      pendingChangesCount: item.pendingChanges?.length ?? 0
    };
  }
}

// Surname order, the way a contact list is read. A contact with no last
// name sorts to the end rather than to the top, where a run of blanks would
// be the first thing anyone sees.
const byLastThenFirst = (a: ContactReportRow, b: ContactReportRow): number => {
  if (!a.lastName !== !b.lastName) {
    return a.lastName ? -1 : 1;
  }
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
};
