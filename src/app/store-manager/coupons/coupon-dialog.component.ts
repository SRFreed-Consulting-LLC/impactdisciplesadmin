import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, merge } from 'rxjs';
import { CouponModel } from 'impactdisciplescommon/src/models/utils/coupon.model';
import { CouponService } from 'impactdisciplescommon/src/services/data/coupon.service';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { ProductService } from 'impactdisciplescommon/src/services/data/product.service';
import { EventService } from 'impactdisciplescommon/src/services/data/event.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface CouponDialogData {
  item: CouponModel | null;
}

@Component({
    selector: 'app-coupon-dialog',
    templateUrl: './coupon-dialog.component.html',
    styleUrls: ['./coupon-dialog.component.scss'],
    standalone: false
})
export class CouponDialogComponent implements OnInit {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  // Picker-only tag source (Events + Products merged) - app-tag-chips is
  // used here with no (createTag) handler wired up, so typing something
  // that doesn't match an existing option simply doesn't add a chip. That
  // matches the original: this dx-tag-box never had acceptCustomValue/
  // onCustomItemCreating, unlike Products' own Tags field.
  couponTags: TagModel[] = [];

  private itemType = 'Coupon';

  constructor(
    private dialogRef: MatDialogRef<CouponDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: CouponDialogData,
    private fb: FormBuilder,
    private service: CouponService,
    private eventService: EventService,
    private productService: ProductService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;

    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      code: [data.item?.code ?? '', Validators.required],
      percentOff: [data.item?.percentOff ?? null, Validators.required],
      isAffilliate: [data.item?.isAffilliate ?? false],
      affilliateName: [data.item?.affilliateName ?? ''],
      affiliatePaypalAccount: [data.item?.affiliatePaypalAccount ?? ''],
      tags: [data.item?.tags ?? []]
    });
  }

  ngOnInit(): void {
    merge(this.eventService.streamAll(), this.productService.streamAll()).subscribe((items) => {
      items.forEach((item: any) => {
        if (!this.couponTags.some((t) => t.id === item.id)) {
          this.couponTags.push({ id: item.id, tag: item.title ?? item.eventName });
        }
      });
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
    const value: CouponModel = { ...this.data.item, ...this.form.value };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

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
}
