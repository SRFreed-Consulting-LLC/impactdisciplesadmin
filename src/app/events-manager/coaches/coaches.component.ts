import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { CoachDialogComponent } from './coach-dialog.component';

@Component({
    selector: 'app-coaches',
    templateUrl: './coaches.component.html',
    styleUrls: ['./coaches.component.scss'],
    standalone: false
})
export class CoachesComponent implements OnInit {
  coaches$: Observable<CoachModel[]>;

  columns: DataGridColumn<CoachModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'photoUrl', label: 'Photo', filterable: false, sortable: false, value: (item) => item.photoUrl?.name ?? '' },
    { key: 'sortOrder', label: 'Sort Order', type: 'number', filterable: false },
    { key: 'teamPageSortOrder', label: 'Team Page Sort Order', type: 'number', filterable: false },
    { key: 'lastName', label: 'Last' },
    { key: 'firstName', label: 'First' },
    { key: 'title', label: 'Title' },
    { key: 'organization', label: 'Organization', value: (item) => this.organizationName(item) }
  ];

  itemType = 'Coach';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<CoachModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Kept live for organization name lookups in the list - same pattern as
  // Products' categories/series arrays.
  organizations: OrganizationModel[] = [];

  constructor(
    private service: CoachService,
    private organizationService: OrganizationService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.organizationService.streamAll().subscribe((organizations) => {
      this.organizations = organizations;
    });

    this.coaches$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  organizationName(item: CoachModel): string {
    const orgId = typeof item.organization === 'string' ? item.organization : item.organization?.id;
    return this.organizations.find((o) => o.id === orgId)?.name ?? '';
  }

  showAddModal(): void {
    this.dialog.open(CoachDialogComponent, { width: '900px', maxWidth: '95vw', data: { item: null } });
  }

  showEditModal(item: CoachModel): void {
    this.dialog.open(CoachDialogComponent, { width: '900px', maxWidth: '95vw', data: { item } });
  }

  delete(item: CoachModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
