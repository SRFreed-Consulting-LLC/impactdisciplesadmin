import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { ImageModel } from 'src/app/common/models/utils/image.model';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { SnackbarService } from '../../shared/snackbar.service';

export interface CoachDialogData {
  item: CoachModel | null;
}

@Component({
    selector: 'app-coach-dialog',
    templateUrl: './coach-dialog.component.html',
    styleUrls: ['./coach-dialog.component.scss'],
    standalone: false
})
export class CoachDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  richTextModules = RICH_TEXT_TOOLBAR;

  organizations$ = this.organizationService.streamAll();

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // home-page-image-dialog.component.ts (web-manager) for the established
  // explanation of this pattern.
  card: { photoUrl?: ImageModel } = {};

  private itemType = 'Coach';

  constructor(
    private dialogRef: MatDialogRef<CoachDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: CoachDialogData,
    private fb: FormBuilder,
    private service: CoachService,
    private organizationService: OrganizationService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.card.photoUrl = data.item?.photoUrl;

    const orgId = typeof data.item?.organization === 'string' ? data.item?.organization : data.item?.organization?.id;

    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      title: [data.item?.title ?? '', Validators.required],
      organization: [orgId ?? null, Validators.required],
      sortOrder: [data.item?.sortOrder ?? null],
      teamPageSortOrder: [data.item?.teamPageSortOrder ?? null],
      url: [data.item?.url ?? ''],
      shippingAddress: this.fb.group({
        address1: [data.item?.shippingAddress?.address1 ?? ''],
        address2: [data.item?.shippingAddress?.address2 ?? ''],
        city: [data.item?.shippingAddress?.city ?? ''],
        state: [data.item?.shippingAddress?.state ?? ''],
        zip: [data.item?.shippingAddress?.zip ?? ''],
        country: [data.item?.shippingAddress?.country ?? '']
      }),
      phone: this.fb.group({
        countryCode: [data.item?.phone?.countryCode ?? ''],
        number: [data.item?.phone?.number ?? ''],
        type: [data.item?.phone?.type ?? null]
      }),
      bio: [data.item?.bio ?? '']
    });
  }

  showImageUploader(): void {
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    this.isImageUploaderVisible$.next(false);
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
    const value: CoachModel = { ...this.data.item, ...this.form.value, photoUrl: this.card.photoUrl };

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
