import { Component } from '@angular/core';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import { TagModel } from '@impact-common/shared/models/domain/tag.model';
import { PodCastCategoriesService } from 'src/app/common/services/data/pod-cast-categories.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { PodCastCategoryDialogComponent } from './pod-cast-category-dialog.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

// Opened via MatDialog.open(PodCastCategoriesComponent, ...) from
// PodCastsComponent's "Categories" button.
//
// On BaseListComponent since 2026-08-21 (bucket A item #6). Every gate here
// rides canEdit, NOT the base class's usual canAdd/canEdit/canDelete trio:
// this is a nested reference-data dialog with no registry entry of its own,
// so it shares the Pod Casts screen's key, and "may edit Pod Casts" has
// always been the single permission that governs managing its categories.
// Switching delete to canDelete would quietly take the button away from
// anyone holding edit-without-delete, so the three hooks are overridden
// rather than inherited. The template gates its own "New" button on the
// same check.
@Component({
    selector: 'app-pod-cast-categories',
    templateUrl: './pod-cast-categories.component.html',
    styleUrls: ['./pod-cast-categories.component.css'],
    standalone: false
})
export class PodCastCategoriesComponent extends BaseListComponent<TagModel> {
  readonly itemType = 'Categories';
  protected readonly screenKey = 'content-manager.pod-casts';
  readonly columns: DataGridColumn<TagModel>[] = [{ key: 'tag', label: 'Tag' }];
  protected readonly dialogComponent = PodCastCategoryDialogComponent;
  protected override readonly dialogConfig: MatDialogConfig = { width: '400px' };

  constructor(
    service: PodCastCategoriesService,
    public override readonly permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService,
    private readonly dialogRef: MatDialogRef<PodCastCategoriesComponent>
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }

  protected override canAddHere(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  protected override canEditHere(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  protected override canDeleteHere(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
