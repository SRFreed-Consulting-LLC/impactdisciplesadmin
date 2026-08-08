import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { HomePageImageModel } from 'impactdisciplescommon/src/models/domain/home-page-image.model';
import { HomePageImageService } from 'impactdisciplescommon/src/services/data/home-page-images.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { HomePageImageDialogComponent } from './home-page-image-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

@Component({
    selector: 'app-home-page-images',
    templateUrl: './home-page-images.component.html',
    styleUrls: ['./home-page-images.component.css'],
    standalone: false
})
export class HomePageImagesComponent implements OnInit {
  images$: Observable<HomePageImageModel[]>;
  displayedColumns = ['isActive', 'order', 'image', 'date', 'title', 'ctaTitle', 'ctaDestination', 'ctaUrl', 'actions'];
  filterColumns = ['isActive-filter', 'order-filter', 'image-filter', 'date-filter', 'title-filter', 'ctaTitle-filter', 'ctaDestination-filter', 'ctaUrl-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  numberOperators = NUMBER_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Home Page Image';

  actions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: HomePageImageService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.images$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) => {
              const type = field === 'order' ? 'number' : field === 'date' ? 'date' : 'text';
              return matchesColumnFilter(item[field as keyof HomePageImageModel], filters[field], type);
            })
          )
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      ),
      tap(() => this.loading$.next(false))
    );
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(HomePageImageDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item: null }
    });
  }

  showEditModal(item: HomePageImageModel): void {
    this.dialog.open(HomePageImageDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: HomePageImageModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
