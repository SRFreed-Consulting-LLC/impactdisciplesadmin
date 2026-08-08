import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { CourseModel } from 'impactdisciplescommon/src/models/domain/course.model';
import { CourseService } from 'impactdisciplescommon/src/services/data/course.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { CourseDialogComponent } from './course-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

@Component({
    selector: 'app-courses',
    templateUrl: './courses.component.html',
    styleUrls: ['./courses.component.css'],
    standalone: false
})
export class CoursesComponent implements OnInit {
  courses$: Observable<CourseModel[]>;
  displayedColumns = ['title', 'resources', 'length', 'actions'];
  // Second header row of per-column filters, mirroring the original
  // dx-data-grid's dxo-filter-row - see the "-filter" matColumnDefs in the
  // template. One entry per filterable column above, plus 'actions-filter'
  // for the empty cell under Actions.
  filterColumns = ['title-filter', 'resources-filter', 'length-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Course';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    public service: CourseService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.courses$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) =>
              matchesColumnFilter(item[field as keyof CourseModel], filters[field], 'text')
            )
          )
          .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
      )
    );
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(CourseDialogComponent, {
      width: '600px',
      data: { item: null }
    });
  }

  showEditModal(item: CourseModel): void {
    this.dialog.open(CourseDialogComponent, {
      width: '600px',
      data: { item }
    });
  }

  delete(item: CourseModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
