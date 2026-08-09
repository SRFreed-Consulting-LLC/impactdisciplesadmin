import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { OrganizationDialogComponent } from './organization-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-organizations',
    templateUrl: './organizations.component.html',
    styleUrls: ['./organizations.component.css'],
    standalone: false
})
export class OrganizationsComponent implements OnInit {
  organizations$: Observable<OrganizationModel[]>;
  currentRows: OrganizationModel[] = [];
  columns: ColumnDef[] = [
    { key: 'name', label: 'Name', visible: true },
    { key: 'contactName', label: 'Contact Name', visible: true },
    { key: 'city', label: 'City', visible: true },
    { key: 'state', label: 'State', visible: true },
    { key: 'phone', label: 'Phone', visible: true },
    { key: 'phoneType', label: 'Phone Type', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Organization';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    public service: OrganizationService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.organizations$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items
          .filter((item) =>
            Object.keys(filters).every((field) => this.matchesField(item, field, filters[field]))
          )
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
        this.currentRows = filtered;
        return filtered;
      }),
      tap(() => this.loading$.next(false))
    );
  }

  get displayedColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => c.key), 'actions'];
  }

  get filterColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => `${c.key}-filter`), 'actions-filter'];
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  private fieldValue(item: OrganizationModel, field: string): any {
    switch (field) {
      case 'city': return item.address?.city ?? '';
      case 'state': return item.address?.state ?? '';
      case 'phone': return item.phone?.number ?? '';
      case 'phoneType': return item.phone?.type ?? '';
      default: return (item as any)[field];
    }
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<OrganizationModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => this.fieldValue(item, c.key) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'organizations.xlsx');
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
