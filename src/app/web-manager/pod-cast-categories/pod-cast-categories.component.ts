import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { TagModel } from 'src/app/common/models/domain/tag.model';
import { PodCastCategoriesService } from 'src/app/common/services/data/pod-cast-categories.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { PodCastCategoryDialogComponent } from './pod-cast-category-dialog.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

// Opened via MatDialog.open(PodCastCategoriesComponent, ...) from PodCastsComponent's
// "Categories" menu item - there is no standalone route for this screen. Because it's
// always dialog-hosted, its own title bar comes from mat-dialog-title rather than the
// app-list-header primitive used by screens that render inline in the page.
@Component({
    selector: 'app-pod-cast-categories',
    templateUrl: './pod-cast-categories.component.html',
    styleUrls: ['./pod-cast-categories.component.css'],
    standalone: false
})
export class PodCastCategoriesComponent implements OnInit {
  categories$: Observable<TagModel[]>;
  displayedColumns = ['tag', 'actions'];
  // Second header row of per-column filters, mirroring the original
  // dx-data-grid's dxo-filter-row (dropped in an earlier round for this
  // screen specifically, now restored app-wide with the operator dropdown).
  filterColumns = ['tag-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Categories';

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: PodCastCategoriesService,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<PodCastCategoriesComponent>,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.categories$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) =>
              matchesColumnFilter(item[field as keyof TagModel], filters[field], 'text')
            )
          )
          .sort((a, b) => (a.tag ?? '').localeCompare(b.tag ?? ''))
      ),
      tap(() => this.loading$.next(false))
    );
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  onClose(): void {
    this.dialogRef.close();
  }

  showAddModal(): void {
    this.dialog.open(PodCastCategoryDialogComponent, {
      width: '400px',
      data: { item: null }
    });
  }

  showEditModal(item: TagModel): void {
    this.dialog.open(PodCastCategoryDialogComponent, {
      width: '400px',
      data: { item }
    });
  }

  delete(item: TagModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
