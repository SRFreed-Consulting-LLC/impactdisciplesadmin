import { Component, OnInit } from '@angular/core';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';

// No "New Customer" flow any more - customer records are created/kept up to
// date entirely from the storefront's checkout now (see
// functions/src/customer-upsert.functions.ts's onPurchaseCustomerUpsert
// trigger). This screen is edit + review (a mismatch an incoming purchase
// flagged - see ContactDetailsComponent's "Pending Updates" strip) only.
//
// Full-page in-place edit view (mode: 'list' | 'edit', no popup - see
// products.component.ts for the established precedent this mirrors) rather
// than the MatDialog this screen started with (CustomerDialogComponent,
// capped at 1200px/95vw - see contact-details.component.ts's header
// comment for the full redesign rationale/mockup link).
@Component({
    selector: 'app-contacts',
    templateUrl: './contacts.component.html',
    styleUrls: ['./contacts.component.scss'],
    standalone: false
})
export class ContactsComponent implements OnInit {
  mode: 'list' | 'edit' = 'list';

  columns: DataGridColumn<ContactModel>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Number', value: (item) => item.phone?.number ?? '' },
    { key: 'pendingChanges', label: 'Pending Review', filterable: false, value: (item) => this.pendingChangesLabel(item) },
    // Tag-rule/manual tags (see TagRuleModel) - joined for display and the
    // grid's text filter. Hidden by default to keep the grid calm.
    { key: 'tags', label: 'Tags', visible: false, value: (item) => (item.tags ?? []).join(', ') }
  ];

  itemType = 'Contact';

  private readonly screenKey = 'contacts-manager.contacts';

  rowActions: DataGridRowAction<ContactModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // Flags a customer whose most recent purchase disagreed with what's on
  // file (see ContactModel.pendingChanges) - same idea as
  // NewRecordTracker's row--new, just driven by this field instead.
  rowClass = (row: ContactModel): string => ((row.pendingChanges?.length ?? 0) > 0 ? 'row--pending' : '');

  paged: PagedCollectionSource<ContactModel>;

  // ---- Edit state ----
  editingItem: ContactModel | null = null;
  events: EventModel[] = [];

  constructor(
    private service: ContactService,
    private eventService: EventService,
    private permissionService: PermissionService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.paged = new PagedCollectionSource<ContactModel>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'lastName', 'asc'),
      50
    );
  }

  async ngOnInit(): Promise<void> {
    // Each page already comes back ordered by lastName asc from Firestore,
    // and pages are appended in fetch order - no client-side re-sort needed.
    this.paged.loadFirstPage();

    this.events = await this.eventService.getAll();
  }

  pendingChangesLabel(item: ContactModel): string {
    const count = item.pendingChanges?.length ?? 0;
    return count > 0 ? `${count} pending` : '';
  }

  // ---- Edit view ----

  showEditModal(item: ContactModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.editingItem = item;
    this.mode = 'edit';
  }

  // Used for both "Back" (cancel, no save) and a successful Save -
  // ContactDetailsComponent already persisted anything it needed to
  // (pending-change resolutions/notes save immediately, same as the old
  // dialog) before either fires, so returning to the list and reloading
  // page 1 unconditionally is always correct, no "did anything change" flag
  // to thread through any more.
  onEditClosed(): void {
    this.editingItem = null;
    this.mode = 'list';
    this.paged.loadFirstPage();
  }

  delete(item: ContactModel): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
