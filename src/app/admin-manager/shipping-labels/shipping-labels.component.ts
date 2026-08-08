import { Component, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subject, takeUntil } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ShippingLabelBatchRequest } from 'impactdisciplescommon/src/models/domain/shipment-label-batch-request.model';
import { ShippingLabelBatchService } from 'impactdisciplescommon/src/services/data/shipping-label-batch.service';
import { ShippingLabelService } from 'impactdisciplescommon/src/services/data/shipping-label.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ShippingBatchDialogComponent } from './shipping-batch-dialog.component';

@Component({
    selector: 'app-shipping-labels',
    templateUrl: './shipping-labels.component.html',
    styleUrls: ['./shipping-labels.component.css'],
    standalone: false
})
export class ShippingLabelsComponent implements OnInit, OnDestroy {
  batches$: Observable<ShippingLabelBatchRequest[]>;
  displayedColumns = ['createdDate', 'createdBy', 'id', 'actions'];

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

    this.batches$ = this.batchService.streamAll();
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
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
