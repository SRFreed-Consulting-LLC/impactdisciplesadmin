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

@Component({
    selector: 'app-consultations-surveys',
    templateUrl: './consultations-surveys.component.html',
    styleUrls: ['./consultations-surveys.component.css'],
    standalone: false
})
export class ConsultationsSurveysComponent implements OnInit {
  surveys$: Observable<ConsultationSurveyModel[]>;
  displayedColumns = ['date', 'lastName', 'firstName', 'email', 'churchName', 'phone', 'actions'];
  filterColumns = ['date-filter', 'lastName-filter', 'firstName-filter', 'email-filter', 'churchName-filter', 'phone-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Consultation Survey';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: ConsultationSurveyService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.surveys$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) => Object.keys(filters).every((field) => this.matchesField(item, field, filters[field])))
          .sort((a, b) => {
            const aTime = a.date instanceof Date ? a.date.getTime() : 0;
            const bTime = b.date instanceof Date ? b.date.getTime() : 0;
            return bTime - aTime;
          })
      ),
      tap(() => this.loading$.next(false))
    );
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
