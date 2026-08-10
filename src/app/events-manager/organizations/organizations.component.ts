import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { OrganizationDialogComponent } from './organization-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

@Component({
    selector: 'app-organizations',
    templateUrl: './organizations.component.html',
    styleUrls: ['./organizations.component.css'],
    standalone: false
})
export class OrganizationsComponent implements OnInit {
  organizations$: Observable<OrganizationModel[]>;

  columns: DataGridColumn<OrganizationModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'contactName', label: 'Contact Name' },
    { key: 'city', label: 'City', value: (item) => item.address?.city ?? '' },
    { key: 'state', label: 'State', value: (item) => item.address?.state ?? '' },
    { key: 'phone', label: 'Phone Number', value: (item) => item.phone?.number ?? '' },
    { key: 'phoneType', label: 'Type', value: (item) => item.phone?.type ?? '' }
  ];

  itemType = 'Organization';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<OrganizationModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    public service: OrganizationService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.organizations$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  showAddModal(): void {
    this.dialog.open(OrganizationDialogComponent, {
      width: '700px',
      data: { item: null }
    });
  }

  showEditModal(item: OrganizationModel): void {
    this.dialog.open(OrganizationDialogComponent, {
      width: '700px',
      data: { item }
    });
  }

  delete(item: OrganizationModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
