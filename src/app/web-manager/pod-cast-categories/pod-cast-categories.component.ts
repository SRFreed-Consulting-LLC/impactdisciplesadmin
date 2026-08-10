import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { TagModel } from 'src/app/common/models/domain/tag.model';
import { PodCastCategoriesService } from 'src/app/common/services/data/pod-cast-categories.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { PodCastCategoryDialogComponent } from './pod-cast-category-dialog.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

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
  columns: DataGridColumn<TagModel>[] = [{ key: 'tag', label: 'Tag' }];

  // Not its own registry entry - a nested reference-data management dialog
  // reached only from Pod Casts' "Categories" button (already edit-gated
  // there), so it shares that screen's key.
  private readonly screenKey = 'web-manager.pod-casts';

  rowActions: DataGridRowAction<TagModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canEdit(this.screenKey) }];

  itemType = 'Categories';

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: PodCastCategoriesService,
    public permissionService: PermissionService,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<PodCastCategoriesComponent>,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.categories$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  onClose(): void {
    this.dialogRef.close();
  }

  showAddModal(): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(PodCastCategoryDialogComponent, {
      width: '400px',
      data: { item: null }
    });
  }

  showEditModal(item: TagModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(PodCastCategoryDialogComponent, {
      width: '400px',
      data: { item }
    });
  }

  delete(item: TagModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
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
