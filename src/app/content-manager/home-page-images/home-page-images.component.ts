import { Component } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';
import { HomePageImageService } from 'src/app/common/services/data/home-page-images.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { HomePageImageDialogComponent } from './home-page-image-dialog.component';

@Component({
    selector: 'app-home-page-images',
    templateUrl: './home-page-images.component.html',
    styleUrls: ['./home-page-images.component.css'],
    standalone: false
})
export class HomePageImagesComponent extends BaseListComponent<HomePageImageModel> {
  readonly itemType = 'Home Page Image';
  protected readonly screenKey = 'content-manager.home-page-images';
  protected readonly dialogComponent = HomePageImageDialogComponent;
  protected override readonly dialogConfig: MatDialogConfig = { width: '900px', maxWidth: '95vw' };

  readonly columns: DataGridColumn<HomePageImageModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'order', label: 'Order', type: 'number' },
    { key: 'image', label: 'Image', filterable: false, sortable: false, value: (item) => item.image?.name ?? '' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'title', label: 'Title' },
    { key: 'ctaTitle', label: 'Button Title' },
    { key: 'ctaDestination', label: 'Button Internal Destination' },
    { key: 'ctaUrl', label: 'Button External URL' }
  ];

  constructor(
    service: HomePageImageService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }
}
