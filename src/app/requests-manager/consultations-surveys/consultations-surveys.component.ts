import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ConsultationSurveyModel } from 'src/app/common/models/domain/consultation-survey.model';
import { ConsultationSurveyService } from 'src/app/common/services/data/consultation-survey.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConsultationSurveyDialogComponent } from './consultation-survey-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-consultations-surveys',
    templateUrl: './consultations-surveys.component.html',
    styleUrls: ['./consultations-surveys.component.css'],
    standalone: false
})
export class ConsultationsSurveysComponent implements OnInit {
  surveys$: Observable<ConsultationSurveyModel[]>;
  currentRows: ConsultationSurveyModel[] = [];
  columns: ColumnDef[] = [
    { key: 'date', label: 'Date', visible: true },
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'churchName', label: 'Church Name', visible: true },
    { key: 'phone', label: 'Phone', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Consultation Survey';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  // See new-record-tracking.util.ts - marks newly-arrived surveys seen the
  // moment this screen loads, and keeps them highlighted for this page view.
  tracker: NewRecordTracker<ConsultationSurveyModel>;

  constructor(
    private service: ConsultationSurveyService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
  }

  ngOnInit(): void {
    this.surveys$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      tap(([items]) => this.tracker.capture(items)),
      map(([items, filters]) => {
        const filtered = items
          .filter((item) => Object.keys(filters).every((field) => this.matchesField(item, field, filters[field])))
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

  private fieldValue(item: ConsultationSurveyModel, field: string): any {
    switch (field) {
      case 'phone': return item.phone?.number ?? '';
      default: return (item as any)[field];
    }
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<ConsultationSurveyModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => this.fieldValue(item, c.key) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'consultation_surveys.xlsx');
  }

  private matchesField(item: ConsultationSurveyModel, field: string, filter: ColumnFilterValue): boolean {
    if (field === 'phone') {
      return matchesColumnFilter(item.phone?.number, filter, 'text');
    }
    if (field === 'date') {
      return matchesColumnFilter(item.date, filter, 'date');
    }
    return matchesColumnFilter((item as any)[field], filter, 'text');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(ConsultationSurveyDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item: null }
    });
  }

  showEditModal(item: ConsultationSurveyModel): void {
    this.dialog.open(ConsultationSurveyDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: ConsultationSurveyModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
