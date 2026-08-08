import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { SaleModel } from 'impactdisciplescommon/src/models/utils/sale.model';
import { SalesService } from 'impactdisciplescommon/src/services/data/sales.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { SaleDialogComponent } from './sale-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { parseSaleDate } from './sale-date.util';

interface SaleRow extends SaleModel {
  startDateParsed: Date | null;
  endDateParsed: Date | null;
}

@Component({
    selector: 'app-sales',
    templateUrl: './sales.component.html',
    styleUrls: ['./sales.component.css'],
    standalone: false
})
export class SalesComponent implements OnInit {
  sales$: Observable<SaleRow[]>;
  displayedColumns = ['isActive', 'name', 'startDate', 'endDate', 'percentOff', 'amountOff', 'isProducts', 'isEvents', 'isShipping', 'actions'];
  filterColumns = ['isActive-filter', 'name-filter', 'startDate-filter', 'endDate-filter', 'percentOff-filter', 'amountOff-filter', 'isProducts-filter', 'isEvents-filter', 'isShipping-filter', 'actions-filter'];
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
      map(([items, filters]) =>
        items
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
          )
      ),
      tap(() => this.loading$.next(false))
    );
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
