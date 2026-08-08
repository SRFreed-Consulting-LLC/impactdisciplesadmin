import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, Subject, takeUntil, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { PodCastModel } from 'impactdisciplescommon/src/models/domain/pod-cast.model';
import { PodCastService } from 'impactdisciplescommon/src/services/data/pod-cast.service';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { PodCastCategoriesService } from 'impactdisciplescommon/src/services/data/pod-cast-categories.service';
import { PodCastTagsService } from 'impactdisciplescommon/src/services/data/pod-cast-tags.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { PodCastDialogComponent } from './pod-cast-dialog.component';
import { PodCastCategoriesComponent } from '../pod-cast-categories/pod-cast-categories.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

@Component({
    selector: 'app-pod-casts',
    templateUrl: './pod-casts.component.html',
    styleUrls: ['./pod-casts.component.css'],
    standalone: false
})
export class PodCastsComponent implements OnInit, OnDestroy {
  podCasts$: Observable<PodCastModel[]>;
  displayedColumns = ['isActive', 'thumbnail', 'date', 'title', 'category', 'actions'];
  filterColumns = ['isActive-filter', 'thumbnail-filter', 'date-filter', 'title-filter', 'category-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Pod Cast';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() },
    { label: 'Categories', icon: 'view_list', onClick: () => this.showCategoriesModal() },
    { label: 'Synchronize', icon: 'refresh', onClick: () => this.syncPodcasts() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);
  // Separate from loading$: this one drives the full-page "syncing with
  // YouTube, don't leave this page" overlay, matching the original's
  // dx-load-panel - it's shown for the multi-second bulk sync, not for the
  // table's own initial load.
  syncing$ = new BehaviorSubject<boolean>(false);

  podCastCategories: TagModel[] = [];
  podCastTags: TagModel[] = [];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});
  private ngUnsubscribe = new Subject<void>();

  constructor(
    private service: PodCastService,
    private podCastTagService: PodCastTagsService,
    private podCastCategoriesService: PodCastCategoriesService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    this.podCasts$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) => {
              const type = field === 'date' ? 'date' : 'text';
              return matchesColumnFilter(this.fieldValue(item, field), filters[field], type);
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

    this.podCastTagService.streamAll().pipe(takeUntil(this.ngUnsubscribe)).subscribe((tags) => {
      this.podCastTags = tags;
    });

    this.podCastCategories = await this.podCastCategoriesService.getAll();

    this.service.getVideoInfo();
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  categoryName(item: PodCastModel): string {
    return this.podCastCategories.find((category) => category.id === item.category)?.tag ?? '';
  }

  private fieldValue(item: PodCastModel, field: string): any {
    if (field === 'category') {
      return this.categoryName(item);
    }
    return (item as any)[field];
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(PodCastDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item: null, categories: this.podCastCategories, tags: this.podCastTags }
    });
  }

  showEditModal(item: PodCastModel): void {
    this.dialog.open(PodCastDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item, categories: this.podCastCategories, tags: this.podCastTags }
    });
  }

  showCategoriesModal(): void {
    this.dialog.open(PodCastCategoriesComponent, {
      width: '650px'
    });
  }

  delete(item: PodCastModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }

  syncPodcasts(): void {
    this.confirmService.confirm('<i>Are you sure you want to syncronize these records?</i>', 'Confirm').then((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.syncing$.next(true);

      this.service.getVideoInfo().then((vids) => {
        vids.forEach(async (video: any) => {
          let podCast: PodCastModel = await this.service.getById(video.id);

          if (!podCast) {
            podCast = { ...new PodCastModel() };
          }

          podCast.id = video.id;
          podCast.date = video.snippet.publishedAt;
          podCast.isActive = true;
          podCast.thumbnail = {};
          podCast.thumbnail.name = video.snippet.title;
          podCast.thumbnail.url = video.snippet.thumbnails.maxres ? video.snippet.thumbnails.maxres.url : video.snippet.thumbnails.high.url;
          podCast.title = video.snippet.title;
          podCast.videoId = video.contentDetails.videoId;
          podCast.videoType = 'Youtube';
          podCast.description = video.snippet.description;

          await this.service.update(podCast.id, podCast).then(() => {
            this.snackbar.success('Podcasts Synced up with Youtube');
            this.syncing$.next(false);
          });
        });
      });
    });
  }
}
