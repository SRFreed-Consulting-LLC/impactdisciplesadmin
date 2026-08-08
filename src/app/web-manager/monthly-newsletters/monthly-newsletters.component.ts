import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MonthlyNewsletterModel } from 'impactdisciplescommon/src/models/domain/monthly-newsletter.model';
import { MonthlyNewletterService } from 'impactdisciplescommon/src/services/data/monthly-newsletter.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { MonthlyNewsletterDialogComponent } from './monthly-newsletter-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

// Previously an inline-editable dx-data-grid (dxo-editing mode="row") with no
// separate add/edit popup at all. Material has no inline-row-edit equivalent
// for MatTable, so this now follows the same popup-based add/edit pattern as
// every other migrated screen instead - see MonthlyNewsletterDialogComponent.
@Component({
    selector: 'app-monthly-newsletters',
    templateUrl: './monthly-newsletters.component.html',
    styleUrls: ['./monthly-newsletters.component.css'],
    standalone: false
})
export class MonthlyNewslettersComponent implements OnInit {
  newsletters$: Observable<MonthlyNewsletterModel[]>;
  displayedColumns = ['isActive', 'date', 'title', 'url', 'actions'];
  // Second header row of per-column filters, mirroring dx-data-grid's
  // dxo-filter-row. The original grid here didn't have a filter row, but
  // it's added for consistency with every other migrated table. No filter
  // on isActive - it's a status badge, not free text.
  filterColumns = ['isActive-filter', 'date-filter', 'title-filter', 'url-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Monthly Newletter';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: MonthlyNewletterService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.newsletters$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items.filter((item) =>
          Object.keys(filters).every((field) =>
            matchesColumnFilter(
              item[field as keyof MonthlyNewsletterModel],
              filters[field],
              field === 'date' ? 'date' : 'text'
            )
          )
        )
      ),
      tap(() => this.loading$.next(false))
    );
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(MonthlyNewsletterDialogComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: MonthlyNewsletterModel): void {
    this.dialog.open(MonthlyNewsletterDialogComponent, {
      width: '500px',
      data: { item }
    });
  }

  delete(item: MonthlyNewsletterModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
