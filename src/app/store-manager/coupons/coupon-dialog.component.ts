import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject, merge, takeUntil } from 'rxjs';
import { CouponModel } from '@impact-common/shared/models/utils/coupon.model';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { TagModel } from '@impact-common/shared/models/domain/tag.model';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../shared/base-entity-dialog.component';

export interface CouponDialogData {
  item: CouponModel | null;
}

@Component({
    selector: 'app-coupon-dialog',
    templateUrl: './coupon-dialog.component.html',
    styleUrls: ['./coupon-dialog.component.scss'],
    standalone: false
})
export class CouponDialogComponent extends BaseEntityDialogComponent<CouponModel>
  implements OnInit, OnDestroy {
  // Picker-only tag source (Events + Products merged) - app-tag-chips is
  // used here with no (createTag) handler wired up, so typing something
  // that doesn't match an existing option simply doesn't add a chip. That
  // matches the original: this dx-tag-box never had acceptCustomValue/
  // onCustomItemCreating, unlike Products' own Tags field.
  couponTags: TagModel[] = [];

  readonly itemType = 'Coupon';

  private ngUnsubscribe = new Subject<void>();

  constructor(
    protected readonly dialogRef: MatDialogRef<CouponDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: CouponDialogData,
    private fb: FormBuilder,
    protected readonly service: CouponService,
    private eventService: EventService,
    private productService: ProductService,
    protected readonly snackbar: SnackbarService
  ) {
    super();

    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      code: [data.item?.code ?? '', Validators.required],
      percentOff: [data.item?.percentOff ?? null, [Validators.required, Validators.min(0), Validators.max(100)]],
      isAffilliate: [data.item?.isAffilliate ?? false],
      affilliateName: [data.item?.affilliateName ?? ''],
      affiliatePaypalAccount: [data.item?.affiliatePaypalAccount ?? ''],
      tags: [data.item?.tags ?? []]
    });
  }

  ngOnInit(): void {
    merge(this.eventService.streamAll(), this.productService.streamAll()).pipe(takeUntil(this.ngUnsubscribe)).subscribe((items) => {
      items.forEach((item) => {
        // item is EventModel | ProductModel - title only exists on the
        // latter, eventName only on the former, so a cast is unavoidable to
        // read whichever one applies.
        const rec = item as unknown as Record<string, unknown>;
        if (!this.couponTags.some((t) => t.id === rec['id'])) {
          this.couponTags.push({ id: rec['id'] as string, tag: (rec['title'] ?? rec['eventName']) as string });
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

}
