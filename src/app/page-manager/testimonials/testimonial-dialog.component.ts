import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { TestimonialModel } from '@impact-common/shared/models/domain/testimonial.model';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { TESTIMONIAL_TYPES } from '@impact-common/shared/lists/testimonial_types.enum';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';
import { SnackbarService } from '../../shared/snackbar.service';

export interface TestimonialDialogData {
  item: TestimonialModel | null;
}

@Component({
    selector: 'app-testimonial-dialog',
    templateUrl: './testimonial-dialog.component.html',
    styleUrls: ['./testimonial-dialog.component.scss'],
    standalone: false
})
export class TestimonialDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
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

  private itemType = 'Testimonial';

  constructor(
    private dialogRef: MatDialogRef<TestimonialDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: TestimonialDialogData,
    private fb: FormBuilder,
    private service: TestimonialService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
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

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    // Matches the original behavior: date is always re-stamped to "now" on
    // save, on both add and edit - not just set once when first created.
    const value: TestimonialModel = {
      ...this.data.item,
      ...this.form.value,
      date: Timestamp.now()
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
    }).catch((err) => {
      // Stop-gap (sweep finding C4, 2026-08-27). Without this a rejected
      // write left inProgress$ stuck true: the spinner span forever, the
      // dialog never closed, and nothing surfaced beyond the console -
      // indistinguishable from a hang. coach-dialog.component.ts fixed and
      // documented exactly this on 2026-08-15; it was never propagated to
      // the other copies of this block.
      console.error('Testimonial save failed', err);
      this.inProgress$.next(false);
      this.snackbar.error('Some Error Occured');
    });
  }
}
