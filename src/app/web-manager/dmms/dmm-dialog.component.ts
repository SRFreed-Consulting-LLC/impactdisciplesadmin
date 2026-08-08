import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { DMMModel } from 'impactdisciplescommon/src/models/domain/dmm.model';
import { DMMService } from 'impactdisciplescommon/src/services/data/dmm.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';

export interface DMMDialogData {
  item: DMMModel | null;
}

@Component({
    selector: 'app-dmm-dialog',
    templateUrl: './dmm-dialog.component.html',
    styleUrls: ['./dmm-dialog.component.scss'],
    standalone: false
})
export class DMMDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  richTextModules = RICH_TEXT_TOOLBAR;

  private itemType = 'Disciple Making Minute';

  constructor(
    private dialogRef: MatDialogRef<DMMDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: DMMDialogData,
    private fb: FormBuilder,
    private service: DMMService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      date: [dateFromTimestamp(data.item?.date) ?? new Date(), Validators.required],
      title: [data.item?.title ?? '', Validators.required],
      text: [data.item?.text ?? '']
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
    const value: DMMModel = { ...this.data.item, ...this.form.value };

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
