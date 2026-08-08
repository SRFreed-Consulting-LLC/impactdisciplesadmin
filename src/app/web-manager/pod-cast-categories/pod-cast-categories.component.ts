import { Component, OnInit } from '@angular/core';
import { map, Observable } from 'rxjs';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { PodCastCategoriesService } from 'impactdisciplescommon/src/services/data/pod-cast-categories.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { PodCastCategoryDialogComponent } from './pod-cast-category-dialog.component';

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

  itemType = 'Categories';

  constructor(
    private service: PodCastCategoriesService,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<PodCastCategoriesComponent>,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.categories$ = this.service.streamAll().pipe(
      map((items) => items.slice().sort((a, b) => (a.tag ?? '').localeCompare(b.tag ?? '')))
    );
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
