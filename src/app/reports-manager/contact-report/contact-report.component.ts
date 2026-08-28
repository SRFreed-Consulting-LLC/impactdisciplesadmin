import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';
import { stateVariants } from 'src/app/common/utils/state-variants';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { ReportColumn, ReportColumnSet } from '../report-column-set';

interface ReportRow {
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

// Reports Manager > Customers - a filterable export over the customers
// collection. Deliberately no Date/List criteria and no group-by mode, both
// present on Purchase Report and Subscriber Report: ContactModel has no
// signup/created-date field at all (customer docs are upserted from
// purchases/event registrations - see customer-upsert.functions.ts - with
// no timestamp stamped anywhere), and there is no list-membership mechanism
// wired to Customers today (the `email_lists` collection's `type:
// 'customers'` entries referenced in an old subscriptions.component.ts
// comment are not read by contacts.component.ts any more - dead
// reference, not a live feature to build a filter against). State is the
// only real queryable field left, same billing-or-shipping-match pattern
// as Purchase Report's own State criterion.
@Component({
    selector: 'app-contact-report',
    templateUrl: './contact-report.component.html',
    styleUrls: ['./contact-report.component.scss'],
    standalone: false
})
export class ContactReportComponent {
  states: string[] = EnumHelper.getStateTypesAsArray();

  criteriaForm: FormGroup;

  readonly columnSet = new ReportColumnSet<ReportRow>([
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'phone', label: 'Phone', visible: true },
    { key: 'billingAddress1', label: 'Billing Address', visible: false },
    { key: 'billingCity', label: 'Billing City', visible: false },
    { key: 'billingState', label: 'Billing State', visible: true },
    { key: 'billingZip', label: 'Billing Zip', visible: false },
    { key: 'shippingAddress1', label: 'Shipping Address', visible: false },
    { key: 'shippingCity', label: 'Shipping City', visible: false },
    { key: 'shippingState', label: 'Shipping State', visible: false },
    { key: 'shippingZip', label: 'Shipping Zip', visible: false },
    { key: 'pendingChangesCount', label: 'Pending Review', visible: true, type: 'number' }
  ]);

  results: ReportRow[] = [];
  loading = false;
  generated = false;
  errorMessage: string | null = null;

  constructor(private service: ContactService, private fb: FormBuilder) {
    this.criteriaForm = this.fb.group({
      stateEnabled: [false],
      state: [null, Validators.required]
    });
  }

  get canGenerate(): boolean {
    return this.criteriaForm.value.stateEnabled;
  }

// Column visibility, grid columns and Excel export all live in
  // ReportColumnSet (sweep P1) - these stay as members so the template
  // bindings are unchanged.
  get columns(): ReportColumn[] {
    return this.columnSet.all;
  }

  get displayedColumns(): string[] {
    return this.columnSet.displayedColumns;
  }

  toggleColumn(column: ReportColumn): void {
    this.columnSet.toggleColumn(column);
  }

  columnLabel(key: string): string {
    return this.columnSet.columnLabel(key);
  }

  get gridColumns(): DataGridColumn<ReportRow>[] {
    return this.columnSet.gridColumns;
  }

  exportExcel(): void {
    void this.columnSet.exportExcel(this.results, 'contact-report.xlsx');
  }

  async generateReport(): Promise<void> {
    if (!this.canGenerate) {
      return;
    }

    this.loading = true;
    this.generated = false;
    this.errorMessage = null;

    try {
      const raw = await this.runQuery();
      this.results = raw.map((item) => this.toRow(item));
      this.generated = true;
    } catch (err) {
      this.errorMessage = (err as { message?: string })?.message ?? 'Something went wrong generating the report.';
    } finally {
      this.loading = false;
    }
  }

  // Same billing-OR-shipping merge as Purchase Report's own runQuery() -
  // one State value can't be expressed as a single query against two
  // different fields, so this runs both and dedupes by id.
  //
  // Crossed with stateVariants() because `customers` overwhelmingly stores
  // the 2-letter CODE while this screen's picker offers full names: before
  // this, filtering by "Georgia" returned 266 contacts out of 2,184, the
  // rest being stored as "GA". Two fields x two spellings = 4 queries, all
  // served by the automatic single-field indexes.
  private async runQuery(): Promise<ContactModel[]> {
    const variants = stateVariants(this.criteriaForm.value.state);
    const results = await Promise.all(
      variants.flatMap((value) => [
        this.service.queryAllByMultiValue([new QueryParam('billingAddress.state', WhereFilterOperandKeys.equal, value)]),
        this.service.queryAllByMultiValue([new QueryParam('shippingAddress.state', WhereFilterOperandKeys.equal, value)])
      ])
    );

    const byId = new Map<string, ContactModel>();
    results.flat().forEach((item) => byId.set(item.id!, item));
    return Array.from(byId.values());
  }

  private toRow(item: ContactModel): ReportRow {
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
