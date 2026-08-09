import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { ConsultationRequestModel } from 'src/app/common/models/domain/consultation-request.model';
import { ConsultationRequestService } from 'src/app/common/services/data/consultation-request.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConsultationRequestDialogComponent } from './consultation-request-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

@Component({
    selector: 'app-consultations-requests',
    templateUrl: './consultations-requests.component.html',
    styleUrls: ['./consultations-requests.component.css'],
    standalone: false
})
export class ConsultationsRequestsComponent implements OnInit {
  requests$: Observable<ConsultationRequestModel[]>;
  displayedColumns = ['date', 'lastName', 'firstName', 'email', 'message', 'actions'];
  // Second header row of per-column filters, mirroring the original
  // dx-data-grid's dxo-filter-row.
  filterColumns = ['date-filter', 'lastName-filter', 'firstName-filter', 'email-filter', 'message-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Consultation Request';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: ConsultationRequestService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.requests$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) =>
              matchesColumnFilter(
                item[field as keyof ConsultationRequestModel],
                filters[field],
                field === 'date' ? 'date' : 'text'
              )
            )
          )
          .sort((a, b) => {
            const aTime = a.date instanceof Date ? a.date.getTime() : 0;
            const bTime = b.date instanceof Date ? b.date.getTime() : 0;
            return bTime - aTime;
          })
      ),
      tap(() => this.loading$.next(false))
    );
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(ConsultationRequestDialogComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: ConsultationRequestModel): void {
    this.dialog.open(ConsultationRequestDialogComponent, {
      width: '500px',
      data: { item }
    });
  }

  delete(item: ConsultationRequestModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
