import { Component } from '@angular/core';
import { Observable, map } from 'rxjs';
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
  readonly itemType = 'Slide';
  // The slider is a SECTION of the Home screen since 2026-08-29 (it was the
  // standalone 'Home Page Images' screen), so it is gated by Home's key.
  protected readonly screenKey = 'page-manager.home';
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

  /**
   * The order numbers used by more than one slide.
   *
   * `order` is what the public slider sorts on, and nothing has ever stopped
   * two slides sharing a number - prod currently has three such pairs (1, 3
   * and 4). Firestore then returns them in whatever order it likes, so the
   * sequence a visitor sees is not the sequence staff think they set, and
   * the old screen gave no hint of it at all.
   *
   * Counts INACTIVE slides too: an off slide holding a number is exactly
   * what makes the next one someone activates land in a surprising place.
   */
  duplicateOrders$!: Observable<number[]>;

  constructor(
    service: HomePageImageService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }

  override ngOnInit(): void {
    super.ngOnInit();
    // Derived here rather than in a field initializer: items$ is assigned by
    // BaseListComponent.ngOnInit(), so an initializer would capture undefined.
    this.duplicateOrders$ = this.items$.pipe(map((rows) => duplicateOrdersIn(rows)));
  }

  /** True when a row's own order is one of the clashing ones. */
  isConflicted(row: HomePageImageModel, duplicates: number[] | null): boolean {
    return !!duplicates && duplicates.includes(row.order);
  }

  /**
   * Writes the running order after a drag.
   *
   * RENUMBERS EVERY SLIDE 0..n-1, not just the ones that moved. That is the
   * point of the feature: `order` was hand-typed for years and production
   * still carries three duplicate pairs, so a drag is also the repair - one
   * drag leaves the whole list with distinct, consecutive numbers and the
   * clash warning goes quiet on its own.
   *
   * Only slides whose number actually CHANGES are written, so renumbering a
   * list that is already consecutive costs nothing.
   */
  async saveOrder(rows: HomePageImageModel[]): Promise<void> {
    const changed = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => row.order !== index);

    if (!changed.length) {
      return;
    }

    try {
      await Promise.all(changed.map(({ row, index }) => {
        row.order = index;
        return this.service.update(row.id, row);
      }));
      this.snackbar.success('Slide order saved');
    } catch (err) {
      console.error('Home slider: could not save the new order', err);
      this.snackbar.error('Could not save the new order - reload and try again');
    }
  }
}

/** Pure, so it can be tested without a component or a service. */
export function duplicateOrdersIn(rows: readonly HomePageImageModel[]): number[] {
  const seen = new Map<number, number>();
  for (const row of rows) {
    if (typeof row.order !== 'number') {
      continue;
    }
    seen.set(row.order, (seen.get(row.order) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([order]) => order).sort((a, b) => a - b);
}
