import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { HomePageImageModel } from 'src/app/common/models/domain/home-page-image.model';
import { HomePageImageService } from 'src/app/common/services/data/home-page-images.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { HomePageImageDialogComponent } from './home-page-image-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

@Component({
    selector: 'app-home-page-images',
    templateUrl: './home-page-images.component.html',
    styleUrls: ['./home-page-images.component.css'],
    standalone: false
})
export class HomePageImagesComponent implements OnInit {
  images$: Observable<HomePageImageModel[]>;

  columns: DataGridColumn<HomePageImageModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'order', label: 'Order', type: 'number' },
    { key: 'image', label: 'Image', filterable: false, sortable: false, value: (item) => item.image?.name ?? '' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'title', label: 'Title' },
    { key: 'ctaTitle', label: 'Button Title' },
    { key: 'ctaDestination', label: 'Button Internal Destination' },
    { key: 'ctaUrl', label: 'Button External URL' }
  ];

  itemType = 'Home Page Image';

  private readonly screenKey = 'content-manager.home-page-images';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<HomePageImageModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: HomePageImageService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.images$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));

    this.headerActions = this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : [];
  }

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(HomePageImageDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item: null }
    });
  }

  showEditModal(item: HomePageImageModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(HomePageImageDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: HomePageImageModel): void {
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
}
