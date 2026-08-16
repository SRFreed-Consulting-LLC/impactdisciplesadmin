import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { LibraryBulkDiscountTierService } from 'src/app/common/services/data/library/library-bulk-discount-tier.service';
import { LibraryErrorLogService } from 'src/app/common/services/data/library/library-error-log.service';
import { BulkDiscountTier } from '@impact-common/models/bulk-discount-tier.model';
import { EditTierDialogComponent, EditTierDialogResult } from '../dialogs/edit-tier-dialog.component';

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/config/config.component.ts. App-wide Library staff
 * configuration - currently just the bulk-purchase discount tiers a group
 * leader's license purchase is priced against (see the reader app's "Buy
 * Licenses" dialog). Adapted to this app's tab-shell convention (a NavLeaf
 * under Library Manager, not its own top-level route with a "Back to
 * library"/Help header - see LibraryManagerComponent, same adaptation
 * Subtemplates/Lesson Templates already made). Uses this app's own
 * ConfirmService/SnackbarService instead of porting the source's
 * ConfirmDialogComponent/MatSnackBar-direct calls.
 */
@Component({
  selector: 'app-library-config',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './config.component.html',
  styleUrl: './config.component.scss',
})
export class LibraryConfigComponent implements OnInit {
  readonly displayedColumns = ['numberOfBooks', 'percentOff', 'actions'];
  tiers: BulkDiscountTier[] = [];
  loading = true;

  constructor(
    private tierService: LibraryBulkDiscountTierService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private dialog: MatDialog,
    private errorLog: LibraryErrorLogService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.tierService.getTiers().then((tiers) => {
      this.tiers = tiers;
      this.loading = false;
    });
  }

  /** BulkDiscountTier has no `id` field - its doc id IS
   *  String(numberOfBooks) (see LibraryBulkDiscountTierService's doc
   *  comment), so numberOfBooks is already its natural unique key. */
  trackByTierId(_index: number, tier: BulkDiscountTier): number {
    return tier.numberOfBooks;
  }

  async openCreateDialog(): Promise<void> {
    const ref = this.dialog.open(EditTierDialogComponent, { width: '400px', data: {} });
    const result: EditTierDialogResult | undefined = await firstValueFrom(ref.afterClosed());
    if (!result) {
      return;
    }
    try {
      await this.tierService.createTier(result.numberOfBooks, result.percentOff);
      this.snackbar.success('Discount tier created.');
      this.load();
    } catch (error) {
      this.errorLog.logError('ConfigComponent.openCreateDialog', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Something went wrong creating the tier. Please try again.';
      this.snackbar.error(message);
    }
  }

  async openEditDialog(tier: BulkDiscountTier): Promise<void> {
    const ref = this.dialog.open(EditTierDialogComponent, {
      width: '400px',
      data: { existingTier: tier },
    });
    const result: EditTierDialogResult | undefined = await firstValueFrom(ref.afterClosed());
    if (!result) {
      return;
    }
    try {
      await this.tierService.updateTier(result.numberOfBooks, result.percentOff);
      this.snackbar.success('Discount tier updated.');
      this.load();
    } catch (error) {
      this.errorLog.logError('ConfigComponent.openEditDialog', error);
      this.snackbar.error('Something went wrong saving changes. Please try again.');
    }
  }

  async deleteTier(tier: BulkDiscountTier, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    const confirmed = await this.confirmService.confirm(
      `Delete the ${tier.numberOfBooks}-book discount tier? This cannot be undone.`,
      'Delete discount tier',
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.tierService.deleteTier(tier.numberOfBooks);
      this.snackbar.success('Discount tier deleted.');
      this.load();
    } catch (error) {
      this.errorLog.logError('ConfigComponent.deleteTier', error);
      this.snackbar.error('Something went wrong deleting the tier. Please try again.');
    }
  }
}
