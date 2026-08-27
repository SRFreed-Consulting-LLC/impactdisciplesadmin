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
  // maxHeight lifts Material's default 65vh cap on dialog CONTENT, which was
  // what put a scrollbar on this form: the fields fit comfortably in the
  // window, just not in two thirds of it (owner, 2026-08-27). The cap is
  // raised, not removed - on a short laptop the form still scrolls rather
  // than running off the screen.
  protected override readonly dialogConfig: MatDialogConfig = {
    // 1120 = the 440px preview rail + the 16px gap + a form column wide
    // enough for its paired fields, with the dialog's own padding on top.
    width: '1120px', maxWidth: '95vw', maxHeight: '94vh'
  };

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
