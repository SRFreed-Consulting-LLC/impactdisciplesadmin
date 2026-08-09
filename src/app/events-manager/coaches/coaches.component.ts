import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { CoachDialogComponent } from './coach-dialog.component';

@Component({
    selector: 'app-coaches',
    templateUrl: './coaches.component.html',
    styleUrls: ['./coaches.component.scss'],
    standalone: false
})
export class CoachesComponent implements OnInit {
  coaches$: Observable<CoachModel[]>;
  displayedColumns = ['isActive', 'photoUrl', 'sortOrder', 'teamPageSortOrder', 'lastName', 'firstName', 'title', 'organization', 'actions'];
  filterColumns = ['isActive-filter', 'photoUrl-filter', 'sortOrder-filter', 'teamPageSortOrder-filter', 'lastName-filter', 'firstName-filter', 'title-filter', 'organization-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Coach';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Kept live for organization name lookups in the list - same pattern as
  // Products' categories/series arrays.
  organizations: OrganizationModel[] = [];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

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

    this.coaches$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) => Object.keys(filters).every((field) => this.matchesField(item, field, filters[field])))
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      ),
      tap(() => this.loading$.next(false))
    );
  }

  organizationName(item: CoachModel): string {
    const orgId = typeof item.organization === 'string' ? item.organization : item.organization?.id;
    return this.organizations.find((o) => o.id === orgId)?.name ?? '';
  }

  private matchesField(item: CoachModel, field: string, filter: ColumnFilterValue): boolean {
    if (field === 'organization') {
      return matchesColumnFilter(this.organizationName(item), filter, 'text');
    }
    return matchesColumnFilter((item as any)[field], filter, 'text');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
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
