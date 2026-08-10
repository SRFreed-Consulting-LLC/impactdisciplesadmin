import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { SaleModel } from 'src/app/common/models/utils/sale.model';
import { SalesService } from 'src/app/common/services/data/sales.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { SaleDialogComponent } from './sale-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { parseSaleDate } from './sale-date.util';

interface SaleRow extends SaleModel {
  startDateParsed: Date | null;
  endDateParsed: Date | null;
}

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-sales',
    templateUrl: './sales.component.html',
    styleUrls: ['./sales.component.css'],
    standalone: false
})
export class SalesComponent implements OnInit {
  sales$: Observable<SaleRow[]>;
  currentRows: SaleRow[] = [];
  columns: ColumnDef[] = [
    { key: 'isActive', label: 'Live', visible: true },
    { key: 'name', label: 'Name', visible: true },
    { key: 'startDate', label: 'From', visible: true },
    { key: 'endDate', label: 'To', visible: true },
    { key: 'percentOff', label: 'Percent Off', visible: true },
    { key: 'amountOff', label: 'Amount Off', visible: true },
    { key: 'isProducts', label: 'Products', visible: true },
    { key: 'isEvents', label: 'Events', visible: true },
    { key: 'isShipping', label: 'Shipping', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;
  numberOperators = NUMBER_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Sale';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: SalesService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.sales$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items
          .map((item) => ({
            ...item,
            startDateParsed: parseSaleDate(item.startDate),
            endDateParsed: parseSaleDate(item.endDate)
          }))
          .filter((item) =>
            Object.keys(filters).every((field) => {
              if (field === 'startDate') {
                return matchesColumnFilter(item.startDateParsed, filters[field], 'date');
              }
              if (field === 'endDate') {
                return matchesColumnFilter(item.endDateParsed, filters[field], 'date');
              }
              const type = field === 'percentOff' || field === 'amountOff' ? 'number' : 'text';
              return matchesColumnFilter(item[field as keyof SaleModel], filters[field], type);
            })
          );
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

  private fieldValue(item: SaleRow, field: string): unknown {
    switch (field) {
      case 'isActive': return item.isActive ? 'LIVE' : 'INACTIVE';
      case 'startDate': return item.startDateParsed;
      case 'endDate': return item.endDateParsed;
      case 'isProducts': return item.isProducts ? 'Yes' : 'No';
      case 'isEvents': return item.isEvents ? 'Yes' : 'No';
      case 'isShipping': return item.isShipping ? 'Yes' : 'No';
      default: return (item as unknown as Record<string, unknown>)[field];
    }
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<SaleRow>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => (this.fieldValue(item, c.key) as string | number | Date | null | undefined) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'sales.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(SaleDialogComponent, {
      width: '600px',
      data: { item: null }
    });
  }

  showEditModal(item: SaleModel): void {
    this.dialog.open(SaleDialogComponent, {
      width: '600px',
      data: { item }
    });
  }

  delete(item: SaleModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
