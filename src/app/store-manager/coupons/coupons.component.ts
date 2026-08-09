import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { CouponModel } from 'src/app/common/models/utils/coupon.model';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { CouponDialogComponent } from './coupon-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-coupons',
    templateUrl: './coupons.component.html',
    styleUrls: ['./coupons.component.scss'],
    standalone: false
})
export class CouponsComponent implements OnInit {
  coupons$: Observable<CouponModel[]>;
  currentRows: CouponModel[] = [];
  columns: ColumnDef[] = [
    { key: 'isActive', label: 'Live', visible: true },
    { key: 'code', label: 'Code', visible: true },
    { key: 'percentOff', label: 'Percent Off', visible: true },
    { key: 'affilliateName', label: 'Affiliate Name', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;
  numberOperators = NUMBER_FILTER_OPERATORS;

  itemType = 'Coupon';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: CouponService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.coupons$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items
          .filter((item) => Object.keys(filters).every((field) => matchesColumnFilter((item as any)[field], filters[field], field === 'percentOff' ? 'number' : 'text')))
          .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''));
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

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<CouponModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => (c.key === 'isActive' ? (item.isActive ? 'LIVE' : 'INACTIVE') : (item as any)[c.key]) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'coupons.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(CouponDialogComponent, { width: '900px', maxWidth: '95vw', data: { item: null } });
  }

  showEditModal(item: CouponModel): void {
    this.dialog.open(CouponDialogComponent, { width: '900px', maxWidth: '95vw', data: { item } });
  }

  delete(item: CouponModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
