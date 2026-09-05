import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { SCREEN_KEYS } from 'src/app/core/main-screen/nav-config';
import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

// Contacts Manager > Organizations - the orgs we keep in contact with
// (churches, ministries, partners), moved here from Events Manager in the
// 2026-08 restructure: an organization is a contact-world record, not an
// events utility. Its child locations and member contacts are managed on
// the in-page details view (OrganizationDetailsComponent - same
// list/edit mode switch as ContactsComponent, no popup).
@Component({
    selector: 'app-organizations',
    templateUrl: './organizations.component.html',
    styleUrls: ['./organizations.component.scss'],
    standalone: false
})
export class OrganizationsComponent extends BaseListComponent<OrganizationModel> {
  mode: 'list' | 'edit' = 'list';

  readonly columns: DataGridColumn<OrganizationModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'pointOfContact', label: 'Point of Contact', value: (item) => this.pocLabel(item) },
    { key: 'city', label: 'City', value: (item) => item.address?.city ?? '' },
    { key: 'state', label: 'State', value: (item) => item.address?.state ?? '' },
    { key: 'phone', label: 'Phone Number', value: (item) => item.phone?.number ?? '' },
    { key: 'email', label: 'Email', visible: false, value: (item) => item.email ?? '' }
  ];

  readonly itemType = 'Organization';
  protected readonly screenKey = SCREEN_KEYS.contacts.organizations;
  // Edited IN PAGE (openEditor below), so there is no dialog.
  protected readonly dialogComponent = undefined;
  protected override readonly deleteConfirmMessage =
    '<i>Are you sure you want to delete this organization? Its locations and member links are not removed automatically.</i>';

  editingItem: OrganizationModel | null = null;

  constructor(
    service: OrganizationService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }

  // Structured PoC when present, else the deprecated free-text contactName
  // old docs still carry (see organization.model.ts).
  pocLabel(item: OrganizationModel): string {
    const poc = item.pointOfContact;
    const name = [poc?.firstName, poc?.lastName].filter(Boolean).join(' ');
    return name || item.contactName || '';
  }

  // Same list/edit mode switch as ContactsComponent - the grid gives way to
  // OrganizationDetailsComponent rather than a popup.
  protected override openEditor(item: OrganizationModel | null): void {
    this.editingItem = item;
    this.mode = 'edit';
  }

  onEditClosed(): void {
    this.editingItem = null;
    this.mode = 'list';
  }
}
