import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from 'firebase/firestore';
import { TestimonialModel } from '@impact-common/shared/models/domain/testimonial.model';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { TESTIMONIAL_TYPES } from '@impact-common/shared/lists/testimonial_types.enum';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';
import { BaseEntityDialogComponent } from '../base-entity-dialog.component';
import { SnackbarService } from '../snackbar.service';

export interface TestimonialDialogData {
  item: TestimonialModel | null;
}

@Component({
    selector: 'app-testimonial-dialog',
    templateUrl: './testimonial-dialog.component.html',
    styleUrls: ['./testimonial-dialog.component.scss'],
    standalone: false
})
export class TestimonialDialogComponent extends BaseEntityDialogComponent<TestimonialModel> {
  testimonialTypes: TESTIMONIAL_TYPES[] = EnumHelper.getTestimonialTypesAsArray();

  /**
   * Which page's look the preview draws.
   *
   * Follows the TYPE field live, so switching the dropdown switches the
   * preview - which is the honest thing: retyping a quote changes where it
   * appears and therefore how it will look.
   */
  get isCoaching(): boolean {
    return this.form?.value?.type === TESTIMONIAL_TYPES.COACHING;
  }

  /**
   * The body split the way the COACHING page splits it - on a blank line (see
   * the web repo's toCoachTestimonial). The customer-reviews block renders the
   * text as one run, so this only matters for the coaching preview, and it is
   * the single thing that preview exists to show.
   */
  get previewParagraphs(): string[] {
    const text = (this.form?.value?.text ?? '').trim();
    if (!text) {
      return [];
    }
    return text.split(/\n\s*\n/).map((p: string) => p.trim()).filter((p: string) => p.length > 0);
  }

  readonly itemType = 'Testimonial';

  constructor(
    protected readonly dialogRef: MatDialogRef<TestimonialDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: TestimonialDialogData,
    private fb: FormBuilder,
    protected readonly service: TestimonialService,
    protected readonly snackbar: SnackbarService
  ) {
    super();
    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      author: [data.item?.author ?? '', Validators.required],
      title: [data.item?.title ?? ''],
      // The public page renders this as the <h4> headline above the body
      // (customer-reviews.component.html). It was on the model and in the
      // data - 3 of the 9 records carry one - but had no field here, so it
      // could be seen on the site and not edited. Saving already preserved
      // it (the payload spreads data.item first), so nothing was being
      // lost; it simply could not be changed.
      quote: [data.item?.quote ?? ''],
      text: [data.item?.text ?? '', Validators.required],
      type: [data.item?.type ?? null, Validators.required]
    });
  }

  // Matches the original behavior: date is always re-stamped to "now" on
  // save, on both add and edit - not just set once when first created.
  protected override buildValue(): TestimonialModel {
    return { ...super.buildValue(), date: Timestamp.now() };
  }
}
