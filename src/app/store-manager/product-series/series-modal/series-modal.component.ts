import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { SeriesModel } from 'src/app/common/models/utils/series.model';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { ImageModel } from 'src/app/common/models/utils/image.model';
import { SnackbarService } from '../../../shared/snackbar.service';

export interface SeriesModalData {
  item: SeriesModel | null;
}

@Component({
    selector: 'app-series-modal',
    templateUrl: './series-modal.component.html',
    styleUrls: ['./series-modal.component.css'],
    standalone: false
})
export class SeriesModalComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // home-page-image-dialog.component.ts (content-manager) for the established
  // explanation of this pattern.
  card: { imageUrl?: ImageModel } = {};

  private itemType = 'Series';

  constructor(
    private dialogRef: MatDialogRef<SeriesModalComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SeriesModalData,
    private fb: FormBuilder,
    private service: SeriesService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.card.imageUrl = data.item?.imageUrl;

    this.form = this.fb.group({
      order: [data.item?.order ?? null, Validators.required],
      name: [data.item?.name ?? '', Validators.required],
      showInStore: [data.item?.showInStore ?? false]
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
    const value: SeriesModel = { ...this.data.item, ...this.form.value, imageUrl: this.card.imageUrl };

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
