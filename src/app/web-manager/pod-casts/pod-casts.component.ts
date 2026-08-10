import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { PodCastModel } from 'src/app/common/models/domain/pod-cast.model';
import { PodCastService, YoutubePlaylistItem } from 'src/app/common/services/data/pod-cast.service';
import { TagModel } from 'src/app/common/models/domain/tag.model';
import { PodCastCategoriesService } from 'src/app/common/services/data/pod-cast-categories.service';
import { PodCastTagsService } from 'src/app/common/services/data/pod-cast-tags.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { PodCastDialogComponent } from './pod-cast-dialog.component';
import { PodCastCategoriesComponent } from '../pod-cast-categories/pod-cast-categories.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

@Component({
    selector: 'app-pod-casts',
    templateUrl: './pod-casts.component.html',
    styleUrls: ['./pod-casts.component.css'],
    standalone: false
})
export class PodCastsComponent implements OnInit, OnDestroy {
  podCasts$: Observable<PodCastModel[]>;

  columns: DataGridColumn<PodCastModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'thumbnail', label: 'Thumbnail', filterable: false, sortable: false, value: (item) => item.thumbnail?.name ?? '' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'title', label: 'Title' },
    { key: 'category', label: 'Category', value: (item) => this.categoryName(item) }
  ];

  itemType = 'Pod Cast';

  private readonly screenKey = 'web-manager.pod-casts';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<PodCastModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

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

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private service: PodCastService,
    private podCastTagService: PodCastTagsService,
    private podCastCategoriesService: PodCastCategoriesService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    this.podCasts$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));

    this.podCastTagService.streamAll().pipe(takeUntil(this.ngUnsubscribe)).subscribe((tags) => {
      this.podCastTags = tags;
    });

    this.podCastCategories = await this.podCastCategoriesService.getAll();

    this.service.getVideoInfo();

    this.headerActions = [
      ...(this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : []),
      // Managing categories and re-pulling from YouTube both mutate this
      // screen's data rather than add a single new podcast, so both are
      // gated by edit rather than add.
      ...(this.permissionService.canEdit(this.screenKey) ? [{ label: 'Categories', icon: 'view_list', onClick: () => this.showCategoriesModal() }] : []),
      ...(this.permissionService.canEdit(this.screenKey) ? [{ label: 'Synchronize', icon: 'refresh', onClick: () => this.syncPodcasts() }] : [])
    ];
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  categoryName(item: PodCastModel): string {
    return this.podCastCategories.find((category) => category.id === item.category)?.tag ?? '';
  }

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(PodCastDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item: null, categories: this.podCastCategories, tags: this.podCastTags }
    });
  }

  showEditModal(item: PodCastModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(PodCastDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item, categories: this.podCastCategories, tags: this.podCastTags }
    });
  }

  showCategoriesModal(): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(PodCastCategoriesComponent, {
      width: '650px'
    });
  }

  delete(item: PodCastModel): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }

  syncPodcasts(): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to syncronize these records?</i>', 'Confirm').then((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.syncing$.next(true);

      this.service.getVideoInfo().then((vids) => {
        vids.forEach(async (video: YoutubePlaylistItem) => {
          let podCast: PodCastModel = await this.service.getById(video.id);

          if (!podCast) {
            podCast = { ...new PodCastModel() };
          }

          podCast.id = video.id;
          podCast.date = new Date(video.snippet.publishedAt);
          podCast.isActive = true;
          podCast.thumbnail = {
            name: video.snippet.title,
            url: video.snippet.thumbnails.maxres ? video.snippet.thumbnails.maxres.url : video.snippet.thumbnails.high.url
          };
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
