import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { LunchAndLearnModel } from 'src/app/common/models/domain/lunch-and-learn.model';
import { LunchAndLearnService } from 'src/app/common/services/data/lunch-and-learn.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { LunchAndLearnDialogComponent } from './lunch-and-learn-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-lunch-and-learns',
    templateUrl: './lunch-and-learns.component.html',
    styleUrls: ['./lunch-and-learns.component.css'],
    standalone: false
})
export class LunchAndLearnsComponent implements OnInit {
  requests$: Observable<LunchAndLearnModel[]>;
  currentRows: LunchAndLearnModel[] = [];
  columns: ColumnDef[] = [
    { key: 'date', label: 'Date', visible: true },
    { key: 'coordinator', label: 'Coordinator', visible: true },
    { key: 'locationName', label: 'Location Name', visible: true },
    { key: 'requestedDate', label: 'Requested Date', visible: true },
    { key: 'requestedStartTime', label: 'Start Time', visible: true },
    { key: 'requestedEndTime', label: 'End Time', visible: true },
    { key: 'email', label: 'Email', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Lunch and Learn Request';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: LunchAndLearnService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.requests$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items
          .filter((item) =>
            Object.keys(filters).every((field) => {
              const type = field === 'date' || field === 'requestedDate' ? 'date' : 'text';
              return matchesColumnFilter(item[field as keyof LunchAndLearnModel], filters[field], type);
            })
          )
          .sort((a, b) => {
            const aTime = a.date instanceof Date ? a.date.getTime() : 0;
            const bTime = b.date instanceof Date ? b.date.getTime() : 0;
            return bTime - aTime;
          });
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
    const excelColumns: ExcelColumn<LunchAndLearnModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => (item as any)[c.key] ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'lunch_and_learns.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(LunchAndLearnDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { item: null }
    });
  }

  showEditModal(item: LunchAndLearnModel): void {
    this.dialog.open(LunchAndLearnDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: LunchAndLearnModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
