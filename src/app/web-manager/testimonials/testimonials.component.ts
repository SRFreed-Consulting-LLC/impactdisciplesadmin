import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { TestimonialModel } from 'impactdisciplescommon/src/models/domain/testimonial.model';
import { TestimonialService } from 'impactdisciplescommon/src/services/data/testimonial.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { TestimonialDialogComponent } from './testimonial-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

@Component({
    selector: 'app-testimonials',
    templateUrl: './testimonials.component.html',
    styleUrls: ['./testimonials.component.css'],
    standalone: false
})
export class TestimonialsComponent implements OnInit {
  testimonials$: Observable<TestimonialModel[]>;
  displayedColumns = ['isActive', 'author', 'date', 'title', 'type', 'actions'];
  // Second header row of per-column filters, mirroring dx-data-grid's
  // dxo-filter-row. The original grid here didn't have a filter row, but
  // it's added for consistency with every other migrated table. No filter
  // on isActive - it's a status badge, not free text.
  filterColumns = ['isActive-filter', 'author-filter', 'date-filter', 'title-filter', 'type-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Testimonial';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: TestimonialService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.testimonials$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) =>
              matchesColumnFilter(
                item[field as keyof TestimonialModel],
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
    this.dialog.open(TestimonialDialogComponent, {
      width: '600px',
      data: { item: null }
    });
  }

  showEditModal(item: TestimonialModel): void {
    this.dialog.open(TestimonialDialogComponent, {
      width: '600px',
      data: { item }
    });
  }

  delete(item: TestimonialModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
