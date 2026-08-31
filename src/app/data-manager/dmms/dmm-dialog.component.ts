import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DMMModel } from '@impact-common/shared/models/domain/dmm.model';
import { BaseEntityDialogComponent } from '../../shared/base-entity-dialog.component';
import { DMMService } from 'src/app/common/services/data/dmm.service';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface DMMDialogData {
  item: DMMModel | null;
}

@Component({
    selector: 'app-dmm-dialog',
    templateUrl: './dmm-dialog.component.html',
    styleUrls: ['./dmm-dialog.component.scss'],
    standalone: false
})
export class DMMDialogComponent extends BaseEntityDialogComponent<DMMModel> {
  richTextModules = RICH_TEXT_TOOLBAR;

  /** The body as the public page renders it - [innerHTML], because the
   *  editor stores markup. Trusted deliberately: this is the very HTML the
   *  signed-in staff member is composing in the field above, and it is
   *  already published to the public site verbatim. */
  get previewText(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      (this.form?.value?.text as string) || '<p>Your Disciple Making Minute appears here.</p>'
    );
  }

  readonly itemType = 'Disciple Making Minute';

  constructor(
    protected readonly dialogRef: MatDialogRef<DMMDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: DMMDialogData,
    private fb: FormBuilder,
    protected readonly service: DMMService,
    protected readonly snackbar: SnackbarService,
    private sanitizer: DomSanitizer
  ) {
    super();
    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      date: [dateFromTimestamp(data.item?.date) ?? new Date(), Validators.required],
      title: [data.item?.title ?? '', Validators.required],
      text: [data.item?.text ?? '']
    });
  }

}
