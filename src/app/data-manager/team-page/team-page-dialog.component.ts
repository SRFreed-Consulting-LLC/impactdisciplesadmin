import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { ImpactTeamMemberModel } from '@impact-common/shared/models/domain/impact-team-member.model';
import { ImpactTeamService } from 'src/app/common/services/data/impact-team.service';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../shared/base-entity-dialog.component';

export interface TeamPageDialogData {
  item: ImpactTeamMemberModel | null;
}

// Mirrors coach-dialog.component.ts closely (same Person-derived fields,
// same image-uploader/quill-editor conventions) - see this collection's own
// header comment (impact-team.service.ts) for why it's a separate model/
// dialog rather than reusing CoachDialogComponent directly: different
// admin lifecycle (Web Manager, not Events Manager), and no
// teamPageSortOrder/sortOrder split to carry since this collection only
// has the one purpose - just `sortOrder`.
@Component({
    selector: 'app-team-page-dialog',
    templateUrl: './team-page-dialog.component.html',
    styleUrls: ['./team-page-dialog.component.scss'],
    standalone: false
})
export class TeamPageDialogComponent extends BaseEntityDialogComponent<ImpactTeamMemberModel> {
  richTextModules = RICH_TEXT_TOOLBAR;

  /** The bio as the public page renders it - that page uses [innerHTML] on
   *  this same field, so the preview has to as well. Trusted for the same
   *  reason: it is the markup the signed-in staff member is composing, and
   *  it is already published verbatim. */
  get previewBio(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      (this.form?.value?.bio as string) || '<p>The biography appears here.</p>'
    );
  }

  organizations$ = this.organizationService.streamAll();

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // coach-dialog.component.ts for the established explanation.
  card: { photoUrl?: ImageModel } = {};

  readonly itemType = 'Team Member';

  // Closes with a boolean now, like every other entity dialog. It used to
  // close with the saved record, but nothing consumed it: BaseListComponent
  // opens this and never subscribes to afterClosed(), because the list
  // behind it is a live stream. Unified 2026-08-28 (C4).
  constructor(
    protected readonly dialogRef: MatDialogRef<TeamPageDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: TeamPageDialogData,
    private fb: FormBuilder,
    protected readonly service: ImpactTeamService,
    private organizationService: OrganizationService,
    protected readonly snackbar: SnackbarService,
    private sanitizer: DomSanitizer
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

  // See coach-dialog.component.ts's identical comment - photoUrl must be
  // built conditionally, never assigned undefined outright, or Firestore's
  // addDoc()/setDoc() rejects the whole write.
  protected override buildValue(): ImpactTeamMemberModel {
    return {
      ...super.buildValue(),
      ...(this.card.photoUrl ? { photoUrl: this.card.photoUrl } : {})
    };
  }
}
