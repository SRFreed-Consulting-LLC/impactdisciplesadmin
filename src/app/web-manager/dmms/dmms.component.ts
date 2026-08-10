import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { DMMModel } from 'src/app/common/models/domain/dmm.model';
import { DMMService } from 'src/app/common/services/data/dmm.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DMMDialogComponent } from './dmm-dialog.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';

// Proof-of-concept conversion to <app-data-grid> (see shared/data-grid/) -
// this screen used to hand-roll its own filter/sort pipeline, Columns menu,
// export, and mat-table markup (see git history for the pre-conversion
// version); all of that now lives once in the shared grid instead.
@Component({
    selector: 'app-dmms',
    templateUrl: './dmms.component.html',
    styleUrls: ['./dmms.component.css'],
    standalone: false
})
export class DMMServiceComponent implements OnInit {
  dmms$: Observable<DMMModel[]>;

  itemType = 'Disciple Making Minute';

  columns: DataGridColumn<DMMModel>[] = [
    // No filter for isActive (matches the original - filtering a computed
    // LIVE/INACTIVE label by text doesn't map cleanly to the operator set),
    // but it IS sortable - by the underlying boolean, not the label text.
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'title', label: 'Title' }
  ];

  rowActions: DataGridRowAction<DMMModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: DMMService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.dmms$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  showAddModal(): void {
    this.dialog.open(DMMDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item: null }
    });
  }

  showEditModal(item: DMMModel): void {
    this.dialog.open(DMMDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: DMMModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
