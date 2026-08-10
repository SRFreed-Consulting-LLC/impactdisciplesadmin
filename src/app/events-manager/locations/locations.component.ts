import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { LocationModel } from 'src/app/common/models/domain/location.model';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { LocationDialogComponent } from './location-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

@Component({
    selector: 'app-locations',
    templateUrl: './locations.component.html',
    styleUrls: ['./locations.component.css'],
    standalone: false
})
export class LocationsComponent implements OnInit {
  locations$: Observable<LocationModel[]>;

  columns: DataGridColumn<LocationModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'contactName', label: 'Contact Name' },
    { key: 'organization', label: 'Organization', value: (item) => this.organizationName(item) },
    { key: 'city', label: 'City', value: (item) => item.address?.city ?? '' },
    { key: 'state', label: 'State', value: (item) => item.address?.state ?? '' },
    { key: 'phone', label: 'Phone Number', value: (item) => item.phone?.number ?? '' },
    { key: 'phoneType', label: 'Type', value: (item) => item.phone?.type ?? '' }
  ];

  itemType = 'Location';

  organizations: OrganizationModel[] = [];
  private organizationsById: Record<string, OrganizationModel> = {};

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<LocationModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    public service: LocationService,
    private organizationService: OrganizationService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    this.organizations = await this.organizationService.getAll();
    this.organizationsById = Object.fromEntries(this.organizations.map((org) => [org.id, org]));

    this.locations$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  organizationName(item: LocationModel): string {
    const orgId = item.organization as unknown as string;
    return this.organizationsById[orgId]?.name ?? '';
  }

  showAddModal(): void {
    this.dialog.open(LocationDialogComponent, {
      width: '800px',
      data: { item: null, organizations: this.organizations }
    });
  }

  showEditModal(item: LocationModel): void {
    this.dialog.open(LocationDialogComponent, {
      width: '800px',
      data: { item, organizations: this.organizations }
    });
  }

  delete(item: LocationModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
