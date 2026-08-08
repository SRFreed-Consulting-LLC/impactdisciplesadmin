import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { HomePageImageModel } from 'impactdisciplescommon/src/models/domain/home-page-image.model';
import { HomePageImageService } from 'impactdisciplescommon/src/services/data/home-page-images.service';
import { ImageModel } from 'impactdisciplescommon/src/models/utils/image.model';
import menuData from 'impactdisciplescommon/src/services/data/nav-menu-data';
import { SnackbarService } from '../../shared/snackbar.service';

export interface HomePageImageDialogData {
  item: HomePageImageModel | null;
}

export interface Destination {
  text: string;
  value: string;
}

@Component({
    selector: 'app-home-page-image-dialog',
    templateUrl: './home-page-image-dialog.component.html',
    styleUrls: ['./home-page-image-dialog.component.scss'],
    standalone: false
})
export class HomePageImageDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - the
  // uploader writes the picked file straight onto this object's `image`
  // property (see closeImageUploader()), same as the original's
  // [(formData)]="selectedItem" two-way binding into a DevExtreme dx-form.
  card: { image?: ImageModel } = {};

  destinations: Destination[] = [];

  private itemType = 'Home Page Image';

  constructor(
    private dialogRef: MatDialogRef<HomePageImageDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: HomePageImageDialogData,
    private fb: FormBuilder,
    private service: HomePageImageService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.card.image = data.item?.image;

    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      order: [data.item?.order ?? null, Validators.required],
      title: [data.item?.title ?? '', Validators.required],
      text: [data.item?.text ?? ''],
      ctaTitle: [data.item?.ctaTitle ?? '', Validators.required],
      ctaDestination: [data.item?.ctaDestination ?? null],
      ctaUrl: [data.item?.ctaUrl ?? '']
    });

    menuData.forEach((menu) => {
      this.destinations.push({ text: menu.title, value: menu.link });

      if (menu.hasDropdown) {
        menu.dropdownItems.forEach((ddMenu) => {
          this.destinations.push({ text: ddMenu.title, value: ddMenu.link });
        });
      }
    });
    this.destinations.push({ text: 'External', value: 'external' });
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
    // Matches the original's onSave(), which unconditionally reset date to
    // "now" on every save (add AND edit) rather than treating it as an
    // editable field - there was no date input anywhere in the form.
    const value: HomePageImageModel = { ...this.data.item, ...this.form.value, image: this.card.image, date: Timestamp.now() };

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
