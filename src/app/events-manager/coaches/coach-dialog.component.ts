import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { CoachModel } from '@impact-common/shared/models/domain/coach.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
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
  // home-page-image-dialog.component.ts (content-manager) for the established
  // explanation of this pattern.
  card: { photoUrl?: ImageModel } = {};

  private itemType = 'Coach';

  constructor(
    private dialogRef: MatDialogRef<CoachDialogComponent, CoachModel>,
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
    this.dialogRef.close(undefined);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    // this.card.photoUrl is undefined (not just falsy) for a brand new
    // coach with no picture uploaded yet (card starts as {}, no photoUrl
    // key at all) - assigning it unconditionally put an explicit
    // `photoUrl: undefined` key on the object, which Firestore's addDoc()
    // rejects outright ("Unsupported field value: undefined"). Live-
    // diagnosed 2026-08-15 while wiring the "+ New Coach" quick-create
    // (course-dialog.component.ts) - same class of bug as
    // PurchasesService.withStatusHistory()/events.component.ts's own
    // imageUrl fix (see those files' comments): build the key
    // conditionally so it's omitted rather than present-with-undefined.
    // Pre-existing on the plain Coaches "New" button too, not just the new
    // quick-create path - this dialog is shared by both.
    const value: CoachModel = { ...this.data.item, ...this.form.value, ...(this.card.photoUrl ? { photoUrl: this.card.photoUrl } : {}) };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    // Closes with the saved entity (not just a boolean) - callers that need
    // the newly-created record back (e.g. course-dialog.component.ts's
    // "+ New Coach" quick-create) can select it immediately without a
    // second round-trip; existing callers (coaches.component.ts) already
    // refresh their own list off a live streamAll() and never read this
    // result at all, so widening it is a no-op for them.
    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.dialogRef.close(result);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    }).catch((err) => {
      // Without this, a rejected write (e.g. the undefined-field case
      // above, before this fix) left inProgress$ stuck true forever and
      // the dialog never closed - no error surfaced beyond the browser
      // console, indistinguishable from a hang.
      console.error('Coach save failed', err);
      this.inProgress$.next(false);
      this.snackbar.error('Some Error Occured');
    });
  }
}
