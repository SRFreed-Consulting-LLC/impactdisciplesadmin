import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { TestimonialModel } from 'src/app/common/models/domain/testimonial.model';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { TestimonialDialogComponent } from './testimonial-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-testimonials',
    templateUrl: './testimonials.component.html',
    styleUrls: ['./testimonials.component.css'],
    standalone: false
})
export class TestimonialsComponent implements OnInit {
  testimonials$: Observable<TestimonialModel[]>;
  currentRows: TestimonialModel[] = [];
  columns: ColumnDef[] = [
    { key: 'isActive', label: 'Live', visible: true },
    { key: 'author', label: 'Author', visible: true },
    { key: 'date', label: 'Date', visible: true },
    { key: 'title', label: 'Title', visible: true },
    { key: 'type', label: 'Testimonial Type', visible: true }
  ];
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
      map(([items, filters]) => {
        const filtered = items
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

  private fieldValue(item: TestimonialModel, field: string): any {
    switch (field) {
      case 'isActive': return item.isActive ? 'LIVE' : 'INACTIVE';
      default: return (item as any)[field];
    }
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<TestimonialModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => this.fieldValue(item, c.key) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'testimonials.xlsx');
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
