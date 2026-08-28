import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FAQModel } from '@impact-common/shared/models/utils/faq.model';
import { FAQService } from 'src/app/common/services/data/faq.service';
import { RICH_TEXT_TOOLBAR } from '../../../../shared/rich-text-editor/quill-toolbar.config';
import { SnackbarService } from '../../../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../../../shared/base-entity-dialog.component';

export interface FaqDialogData {
  item: FAQModel | null;
}

@Component({
    selector: 'app-faq-dialog',
    templateUrl: './faq-dialog.component.html',
    styleUrls: ['./faq-dialog.component.scss'],
    standalone: false
})
export class FaqDialogComponent extends BaseEntityDialogComponent<FAQModel> {
  richTextModules = RICH_TEXT_TOOLBAR;

  readonly itemType = 'FAQ';

  constructor(
    protected readonly dialogRef: MatDialogRef<FaqDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: FaqDialogData,
    private fb: FormBuilder,
    protected readonly service: FAQService,
    protected readonly snackbar: SnackbarService
  ) {
    super();

    this.form = this.fb.group({
      sortOrder: [data.item?.sortOrder ?? null],
      question: [data.item?.question ?? '', Validators.required],
      answer: [data.item?.answer ?? '']
    });
  }

}
