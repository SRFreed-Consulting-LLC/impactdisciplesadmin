import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { CoachModel } from '@impact-common/shared/models/domain/coach.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../shared/base-entity-dialog.component';

export interface CoachDialogData {
  item: CoachModel | null;
}

@Component({
    selector: 'app-coach-dialog',
    templateUrl: './coach-dialog.component.html',
    styleUrls: ['./coach-dialog.component.scss'],
    standalone: false
})
export class CoachDialogComponent extends BaseEntityDialogComponent<CoachModel> {
  richTextModules = RICH_TEXT_TOOLBAR;

  organizations$ = this.organizationService.streamAll();

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // home-page-image-dialog.component.ts (content-manager) for the established
  // explanation of this pattern.
  card: { photoUrl?: ImageModel } = {};

  readonly itemType = 'Coach';

  // Closes with a boolean like every other entity dialog. It used to close
  // with the saved CoachModel, which read as a deliberate contract but was
  // never consumed: BaseListComponent opens this and never subscribes to
  // afterClosed() at all, because the list behind it is a live stream that
  // refreshes itself. Unified 2026-08-28 (C4).
  constructor(
    protected readonly dialogRef: MatDialogRef<CoachDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: CoachDialogData,
    private fb: FormBuilder,
    protected readonly service: CoachService,
    private organizationService: OrganizationService,
    protected readonly snackbar: SnackbarService
  ) {
    super();
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

  // this.card.photoUrl is undefined (not just falsy) for a brand new coach
  // with no picture uploaded yet (card starts as {}, no photoUrl key at
  // all) - assigning it unconditionally put an explicit `photoUrl:
  // undefined` key on the object, which Firestore's addDoc() rejects
  // outright ("Unsupported field value: undefined"). Live-diagnosed
  // 2026-08-15 - same class of bug as PurchasesService.withStatusHistory()
  // and events.component.ts's imageUrl fix (see those files' comments):
  // build the key conditionally so it is OMITTED rather than
  // present-with-undefined. Applies to the plain Coaches "New" button too,
  // not just the quick-create path - this dialog is shared by both.
  protected override buildValue(): CoachModel {
    return {
      ...super.buildValue(),
      ...(this.card.photoUrl ? { photoUrl: this.card.photoUrl } : {})
    };
  }
}
