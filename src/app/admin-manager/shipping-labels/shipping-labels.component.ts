import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ShippingLabelBatchRequest } from 'src/app/common/models/domain/shipment-label-batch-request.model';
import { ShippingLabelBatchService } from 'src/app/common/services/data/shipping-label-batch.service';
import { ShippingLabelService } from 'src/app/common/services/data/shipping-label.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { ShippingBatchDialogComponent } from './shipping-batch-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-shipping-labels',
    templateUrl: './shipping-labels.component.html',
    styleUrls: ['./shipping-labels.component.css'],
    standalone: false
})
export class ShippingLabelsComponent implements OnInit, OnDestroy {
  batches$: Observable<ShippingLabelBatchRequest[]>;
  currentRows: ShippingLabelBatchRequest[] = [];
  columns: ColumnDef[] = [
    { key: 'createdDate', label: 'Created Date', visible: true },
    { key: 'createdBy', label: 'Created By', visible: true },
    { key: 'id', label: 'Id', visible: true }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  itemType = 'Shipping Label Batch';

  actions: ListHeaderAction[] = [{ label: 'Create Shipping Labels', icon: 'add', onClick: () => this.addBatch() }];

  private ngUnsubscribe = new Subject<void>();
  // Was read fresh via authService.getLoggedInUser().email - see
  // events.component.ts for the full explanation (a stale/expired role
  // cookie throwing on a valid Firebase session).
  private currentUserEmail?: string;

  constructor(
    private batchService: ShippingLabelBatchService,
    private labelService: ShippingLabelService,
    private authService: AdminAuthService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.currentUserEmail = user?.email;
    });

    this.batches$ = this.batchService.streamAll().pipe(
      tap((batches) => {
        this.currentRows = batches;
        this.loading$.next(false);
      })
    );
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  get displayedColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => c.key), 'actions'];
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<ShippingLabelBatchRequest>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => (item as any)[c.key] ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'shipping_label_batches.xlsx');
  }

  addBatch(): void {
    const batchRequest: ShippingLabelBatchRequest = {
      ...new ShippingLabelBatchRequest(),
      createdDate: new Date(),
      createdBy: this.currentUserEmail!
    };

    this.batchService.add(batchRequest).then((batch) => {
      this.openBatchDialog(batch);
    });
  }

  editBatch(batch: ShippingLabelBatchRequest): void {
    this.openBatchDialog(batch);
  }

  private openBatchDialog(batch: ShippingLabelBatchRequest): void {
    this.dialog.open(ShippingBatchDialogComponent, {
      width: '1300px',
      maxWidth: '95vw',
      data: { batch }
    });
  }

  deleteBatch(batch: ShippingLabelBatchRequest): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this batch?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.labelService.getAllByValue('batchId', batch.id).then((labels) => {
          Promise.all(labels.map((label) => this.labelService.delete(label.id!))).then(() => {
            this.batchService.delete(batch.id!).then(() => {
              this.snackbar.success(this.itemType + ' Deleted');
            });
          });
        });
      }
    });
  }
}
