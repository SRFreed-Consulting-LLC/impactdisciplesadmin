import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { ShippingLabelBatchRequest, ShippingLabelRequest } from 'src/app/common/models/domain/shipment-label-batch-request.model';
import { ShippingFromAddress } from 'src/app/common/models/domain/shipment.model';
import { ShippingLabelBatchService } from 'src/app/common/services/data/shipping-label-batch.service';
import { ShippingLabelService } from 'src/app/common/services/data/shipping-label.service';
import { WebConfigService } from 'src/app/common/services/data/web-config.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { environment } from 'src/environments/environment';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { ShippingLabelDialogComponent } from './shipping-label-dialog.component';
import { FromAddressDialogComponent } from './from-address-dialog.component';
import { ShippingResultsDialogComponent } from './shipping-results-dialog.component';

export interface ShippingBatchDialogData {
  batch: ShippingLabelBatchRequest;
}

@Component({
    selector: 'app-shipping-batch-dialog',
    templateUrl: './shipping-batch-dialog.component.html',
    styleUrls: ['./shipping-batch-dialog.component.scss'],
    standalone: false
})
export class ShippingBatchDialogComponent {
  batch: ShippingLabelBatchRequest;
  labels$: Observable<ShippingLabelRequest[]>;

  columns: DataGridColumn<ShippingLabelRequest>[] = [
    { key: 'name', label: 'Name', value: (item) => item.request?.shipment?.shipTo?.name },
    { key: 'address', label: 'Address', value: (item) => item.request?.shipment?.shipTo?.addressLine1 },
    { key: 'city', label: 'City', value: (item) => item.request?.shipment?.shipTo?.cityLocality },
    { key: 'state', label: 'State', value: (item) => item.request?.shipment?.shipTo?.stateProvince },
    { key: 'country', label: 'Country', value: (item) => item.request?.shipment?.shipTo?.countryCode },
    { key: 'zip', label: 'Zip', value: (item) => item.request?.shipment?.shipTo?.postalCode },
    { key: 'ounces', label: 'Ounces', value: (item) => item.request?.weight },
    { key: 'status', label: 'Status' },
    { key: 'message', label: 'Message' },
    { key: 'requestedDate', label: 'Label Requested Date', type: 'date' },
    { key: 'purchasedDate', label: 'Label Purchased Date', type: 'date' },
    { key: 'shippingRate', label: 'Shipping Rate', type: 'currency' }
  ];

  rowActions: DataGridRowAction<ShippingLabelRequest>[] = [
    { icon: 'download', tooltip: 'DOWNLOAD SHIPPING LABEL', onClick: (item) => this.getShippingLabel(item), visible: (item) => this.isDownloadVisible(item) },
    { icon: 'edit', tooltip: 'EDIT', onClick: (item) => this.showEditModal(item) },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.deleteLabel(item) }
  ];

  inProgress$ = new BehaviorSubject<boolean>(false);
  spinnerVisible = false;

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private dialogRef: MatDialogRef<ShippingBatchDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ShippingBatchDialogData,
    private labelService: ShippingLabelService,
    private batchService: ShippingLabelBatchService,
    private webConfigService: WebConfigService,
    private authService: AdminAuthService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.batch = data.batch;
    this.labels$ = this.labelService.streamAllByValue('batchId', this.batch.id).pipe(tap(() => this.loading$.next(false)));
  }

  onClose(): void {
    this.dialogRef.close();
  }

  showAddModal(): void {
    this.dialog.open(ShippingLabelDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: { item: null, batchId: this.batch.id }
    });
  }

  showEditModal(item: ShippingLabelRequest): void {
    this.dialog.open(ShippingLabelDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: { item, batchId: this.batch.id }
    });
  }

  deleteLabel(item: ShippingLabelRequest): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.labelService.delete(item.id!).then(() => {
          this.snackbar.success('Shipping Label Deleted');
        });
      }
    });
  }

  isDownloadVisible(item: ShippingLabelRequest): boolean {
    return (item?.shippingRate ?? 0) > 0;
  }

  private downloadShippingLabel(pdf: string): void {
    const link = document.createElement('a');
    link.setAttribute('target', '_blank');
    link.setAttribute('href', pdf);
    link.setAttribute('download', 'shippinglabel.pdf');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  getShippingLabel = async (item: ShippingLabelRequest) => {
    this.spinnerVisible = true;

    if (!item.shippingLabel) {
      const idToken = await this.authService.dao.auth.currentUser?.getIdToken();

      const request = await fetch(environment.shippingLabelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ shipId: item.shippingRateId.rateId })
      });

      const response = await request.json();

      if (response.code == 400) {
        this.snackbar.error(response.error.message);

        item.message = response.error.message;
        item.status = 'FAILED';
        item.shippingLabel = response;
        await this.labelService.update(item.id!, item);

        this.spinnerVisible = false;
      } else {
        item.shippingLabel = response;
        item.status = 'PURCHASED';
        item.purchasedDate = new Date();

        await this.labelService.update(item.id!, item).then((saved) => {
          this.downloadShippingLabel(saved.shippingLabel.labelDownload.pdf);
        });

        this.spinnerVisible = false;
      }
    } else {
      if (item.shippingLabel?.code) {
        this.snackbar.error(item.shippingLabel.error.message);
        this.spinnerVisible = false;
      } else {
        this.downloadShippingLabel(item.shippingLabel.labelDownload.pdf);
        this.spinnerVisible = false;
      }
    }
  };

  // Always resets shipFrom to the org's own configured address before
  // opening the editor (rather than reusing whatever was previously saved
  // on this batch) - matches the original exactly, a deliberate "start from
  // the org default, then let the user tweak it" pattern.
  setFromAddress(): void {
    this.webConfigService.getAll().then((configs) => {
      const shipFrom: ShippingFromAddress = {
        ...new ShippingFromAddress(),
        name: 'Impact Disciples',
        phone: configs[0].phone,
        addressLine1: configs[0].address.address1,
        cityLocality: configs[0].address.city,
        stateProvince: 'GA',
        postalCode: configs[0].address.zip,
        countryCode: 'US'
      };

      const dialogRef = this.dialog.open(FromAddressDialogComponent, {
        width: '600px',
        maxWidth: '95vw',
        data: { batch: this.batch, shipFrom }
      });

      dialogRef.afterClosed().subscribe((savedShipFrom: ShippingFromAddress | false) => {
        if (savedShipFrom) {
          this.batch = { ...this.batch, shipFrom: savedShipFrom };
        }
      });
    });
  }

  generateShippingLabels(): void {
    if (!this.batch.shipFrom) {
      this.snackbar.error("Please verify the return address is correct before generating Shipping Labels");
      return;
    }

    this.confirmService.confirm('<i>Are you sure you want to create these Shipping Labels?</i>', 'Confirm').then((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.spinnerVisible = true;

      this.labelService.getAllByValue('batchId', this.batch.id).then((labels) => {
        const promises = labels
          .filter((label) => label.status == 'NEW' || label.status == 'FAILED')
          .map((label) => {
            label.request.shipment.shipFrom = this.batch.shipFrom;
            return this.labelService.createRequest(label);
          });

        Promise.all(promises).then((results) => {
          this.spinnerVisible = false;

          this.dialog.open(ShippingResultsDialogComponent, {
            width: '420px',
            data: { results }
          });
        });
      });
    });
  }
}
