import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

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
export class OrganizationsComponent implements OnInit {
  mode: 'list' | 'edit' = 'list';

  organizations$: Observable<OrganizationModel[]>;

  columns: DataGridColumn<OrganizationModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'pointOfContact', label: 'Point of Contact', value: (item) => this.pocLabel(item) },
    { key: 'city', label: 'City', value: (item) => item.address?.city ?? '' },
    { key: 'state', label: 'State', value: (item) => item.address?.state ?? '' },
    { key: 'phone', label: 'Phone Number', value: (item) => item.phone?.number ?? '' },
    { key: 'email', label: 'Email', visible: false, value: (item) => item.email ?? '' }
  ];

  itemType = 'Organization';

  private readonly screenKey = 'contacts-manager.organizations';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<OrganizationModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  editingItem: OrganizationModel | null = null;

  constructor(
    public service: OrganizationService,
    private permissionService: PermissionService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.organizations$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));

    this.headerActions = this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : [];
  }

  // Structured PoC when present, else the deprecated free-text contactName
  // old docs still carry (see organization.model.ts).
  pocLabel(item: OrganizationModel): string {
    const poc = item.pointOfContact;
    const name = [poc?.firstName, poc?.lastName].filter(Boolean).join(' ');
    return name || item.contactName || '';
  }

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.editingItem = null;
    this.mode = 'edit';
  }

  showEditModal(item: OrganizationModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.editingItem = item;
    this.mode = 'edit';
  }

  onEditClosed(): void {
    this.editingItem = null;
    this.mode = 'list';
  }

  delete(item: OrganizationModel): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this organization? Its locations and member links are not removed automatically.</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
