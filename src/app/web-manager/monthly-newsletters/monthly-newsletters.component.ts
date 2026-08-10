import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MonthlyNewsletterModel } from 'src/app/common/models/domain/monthly-newsletter.model';
import { MonthlyNewletterService } from 'src/app/common/services/data/monthly-newsletter.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { MonthlyNewsletterDialogComponent } from './monthly-newsletter-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

// Previously an inline-editable dx-data-grid (dxo-editing mode="row") with no
// separate add/edit popup at all. Material has no inline-row-edit equivalent
// for MatTable, so this now follows the same popup-based add/edit pattern as
// every other migrated screen instead - see MonthlyNewsletterDialogComponent.
@Component({
    selector: 'app-monthly-newsletters',
    templateUrl: './monthly-newsletters.component.html',
    styleUrls: ['./monthly-newsletters.component.css'],
    standalone: false
})
export class MonthlyNewslettersComponent implements OnInit {
  newsletters$: Observable<MonthlyNewsletterModel[]>;

  columns: DataGridColumn<MonthlyNewsletterModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'title', label: 'Title' },
    { key: 'url', label: 'Url' }
  ];

  itemType = 'Monthly Newletter';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<MonthlyNewsletterModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: MonthlyNewletterService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.newsletters$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  showAddModal(): void {
    this.dialog.open(MonthlyNewsletterDialogComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: MonthlyNewsletterModel): void {
    this.dialog.open(MonthlyNewsletterDialogComponent, {
      width: '500px',
      data: { item }
    });
  }

  delete(item: MonthlyNewsletterModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
