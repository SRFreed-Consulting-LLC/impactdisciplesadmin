import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { OrganizationModel } from 'impactdisciplescommon/src/models/domain/organization.model';
import { OrganizationService } from 'impactdisciplescommon/src/services/data/organization.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { OrganizationDialogComponent } from './organization-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

@Component({
    selector: 'app-organizations',
    templateUrl: './organizations.component.html',
    styleUrls: ['./organizations.component.css'],
    standalone: false
})
export class OrganizationsComponent implements OnInit {
  organizations$: Observable<OrganizationModel[]>;
  displayedColumns = ['name', 'contactName', 'city', 'state', 'phone', 'phoneType', 'actions'];
  filterColumns = ['name-filter', 'contactName-filter', 'city-filter', 'state-filter', 'phone-filter', 'phoneType-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Organization';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    public service: OrganizationService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.organizations$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) => this.matchesField(item, field, filters[field]))
          )
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      )
    );
  }

  private matchesField(item: OrganizationModel, field: string, filter: ColumnFilterValue): boolean {
    if (field === 'city') {
      return matchesColumnFilter(item.address?.city, filter, 'text');
    }
    if (field === 'state') {
      return matchesColumnFilter(item.address?.state, filter, 'text');
    }
    if (field === 'phone') {
      return matchesColumnFilter(item.phone?.number, filter, 'text');
    }
    if (field === 'phoneType') {
      return matchesColumnFilter(item.phone?.type, filter, 'text');
    }
    return matchesColumnFilter(item[field as keyof OrganizationModel], filter, 'text');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
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
