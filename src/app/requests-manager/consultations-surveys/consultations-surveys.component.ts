import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ConsultationSurveyModel } from 'src/app/common/models/domain/consultation-survey.model';
import { ConsultationSurveyService } from 'src/app/common/services/data/consultation-survey.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConsultationSurveyDialogComponent } from './consultation-survey-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';

@Component({
    selector: 'app-consultations-surveys',
    templateUrl: './consultations-surveys.component.html',
    styleUrls: ['./consultations-surveys.component.css'],
    standalone: false
})
export class ConsultationsSurveysComponent implements OnInit {
  surveys$: Observable<ConsultationSurveyModel[]>;

  columns: DataGridColumn<ConsultationSurveyModel>[] = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'churchName', label: 'Church Name' },
    { key: 'phone', label: 'Number', value: (item) => item.phone?.number ?? '' }
  ];

  itemType = 'Consultation Survey';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<ConsultationSurveyModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

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
    this.surveys$ = this.service.streamAll().pipe(
      tap((items) => this.tracker.capture(items)),
      tap(() => this.loading$.next(false))
    );
  }

  rowClass = (row: ConsultationSurveyModel): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

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
