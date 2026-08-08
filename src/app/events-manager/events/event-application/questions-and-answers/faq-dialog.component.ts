import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { FAQModel } from 'impactdisciplescommon/src/models/utils/faq.model';
import { FAQService } from 'impactdisciplescommon/src/services/data/faq.service';
import { RICH_TEXT_TOOLBAR } from '../../../../shared/rich-text-editor/quill-toolbar.config';
import { SnackbarService } from '../../../../shared/snackbar.service';

export interface FaqDialogData {
  item: FAQModel | null;
}

@Component({
    selector: 'app-faq-dialog',
    templateUrl: './faq-dialog.component.html',
    styleUrls: ['./faq-dialog.component.scss'],
    standalone: false
})
export class FaqDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  richTextModules = RICH_TEXT_TOOLBAR;

  private itemType = 'FAQ';

  constructor(
    private dialogRef: MatDialogRef<FaqDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: FaqDialogData,
    private fb: FormBuilder,
    private service: FAQService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;

    this.form = this.fb.group({
      sortOrder: [data.item?.sortOrder ?? null],
      question: [data.item?.question ?? '', Validators.required],
      answer: [data.item?.answer ?? '']
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
    const value: FAQModel = { ...this.data.item, ...this.form.value };

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
