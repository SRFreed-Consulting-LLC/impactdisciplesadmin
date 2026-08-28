import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { SeriesModel } from '@impact-common/shared/models/utils/series.model';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { SnackbarService } from '../../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../../shared/base-entity-dialog.component';

export interface SeriesModalData {
  item: SeriesModel | null;
}

@Component({
    selector: 'app-series-modal',
    templateUrl: './series-modal.component.html',
    styleUrls: ['./series-modal.component.css'],
    standalone: false
})
export class SeriesModalComponent extends BaseEntityDialogComponent<SeriesModel> {
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // home-page-image-dialog.component.ts (content-manager) for the established
  // explanation of this pattern.
  card: { imageUrl?: ImageModel } = {};

  readonly itemType = 'Series';

  constructor(
    protected readonly dialogRef: MatDialogRef<SeriesModalComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: SeriesModalData,
    private fb: FormBuilder,
    protected readonly service: SeriesService,
    protected readonly snackbar: SnackbarService
  ) {
    super();
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

  // The image lives on the uploader card, not in the form. Unlike the
  // coach/team-page photoUrl, this one IS assigned unconditionally, which
  // matches the original - SeriesModel.imageUrl is optional and the write
  // path here has never hit the undefined-field rejection those two did.
  protected override buildValue(): SeriesModel {
    return { ...super.buildValue(), imageUrl: this.card.imageUrl };
  }

}
