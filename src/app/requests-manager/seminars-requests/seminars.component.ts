import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SeminarModel } from 'src/app/common/models/domain/seminar.model';
import { SeminarService } from 'src/app/common/services/data/seminar.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { SeminarDialogComponent } from './seminar-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

@Component({
    selector: 'app-seminars',
    templateUrl: './seminars.component.html',
    styleUrls: ['./seminars.component.css'],
    standalone: false
})
export class SeminarsComponent implements OnInit {
  seminars$: Observable<SeminarModel[]>;
  displayedColumns = ['date', 'eventCoordinator', 'preferredLocationName', 'requestedDate', 'requestedStartTime', 'requestedEndTime', 'email', 'actions'];
  filterColumns = ['date-filter', 'eventCoordinator-filter', 'preferredLocationName-filter', 'requestedDate-filter', 'requestedStartTime-filter', 'requestedEndTime-filter', 'email-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Seminar Request';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: SeminarService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.seminars$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) => {
              const type = field === 'date' || field === 'requestedDate' ? 'date' : 'text';
              return matchesColumnFilter(item[field as keyof SeminarModel], filters[field], type);
            })
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
    this.dialog.open(SeminarDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { item: null }
    });
  }

  showEditModal(item: SeminarModel): void {
    this.dialog.open(SeminarDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: SeminarModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
