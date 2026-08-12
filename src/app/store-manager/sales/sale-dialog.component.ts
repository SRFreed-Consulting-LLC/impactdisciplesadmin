import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { SaleModel } from 'src/app/common/models/utils/sale.model';
import { SalesService } from 'src/app/common/services/data/sales.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { parseSaleDate } from './sale-date.util';

export interface SaleDialogData {
  item: SaleModel | null;
}

// The original dxDateBox editors used dateSerializationFormat: 'yyyy-MM-dd',
// so startDate/endDate are stored as plain date strings (older records may
// still be raw Firestore Timestamps, hence the model's `Timestamp | string`
// type and the parseSaleDate() helper) - saves here keep writing that same
// 'yyyy-MM-dd' string shape rather than switching to Timestamps.
@Component({
    selector: 'app-sale-dialog',
    templateUrl: './sale-dialog.component.html',
    styleUrls: ['./sale-dialog.component.scss'],
    standalone: false
})
export class SaleDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Sale';

  constructor(
    private dialogRef: MatDialogRef<SaleDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SaleDialogData,
    private fb: FormBuilder,
    private service: SalesService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      name: [data.item?.name ?? '', Validators.required],
      percentOff: [data.item?.percentOff ?? null, [Validators.required, Validators.min(0), Validators.max(100)]],
      startDate: [parseSaleDate(data.item?.startDate), Validators.required],
      endDate: [parseSaleDate(data.item?.endDate), Validators.required],
      isProducts: [data.item?.isProducts ?? false],
      isEvents: [data.item?.isEvents ?? false],
      isShipping: [data.item?.isShipping ?? false]
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const value: SaleModel = {
      ...this.data.item,
      ...this.form.value,
      startDate: this.toDateString(this.form.value.startDate),
      endDate: this.toDateString(this.form.value.endDate)
    };

    const request = this.isEdit
      ? this.service.update(value.id!, value)
      : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  private toDateString(date: Date | null): string | null {
    if (!date) {
      return null;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
