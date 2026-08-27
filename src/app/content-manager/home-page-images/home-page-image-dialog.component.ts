import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';
import { HomePageImageService } from 'src/app/common/services/data/home-page-images.service';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import menuData from 'src/app/common/services/data/nav-menu-data';
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
  isMobileImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - the
  // uploader writes the picked file straight onto this object's `image`
  // property (see closeImageUploader()), same as the original's
  // [(formData)]="selectedItem" two-way binding into a DevExtreme dx-form.
  card: { image?: ImageModel; mobileImage?: ImageModel } = {};

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
    this.card.mobileImage = data.item?.mobileImage;

    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      order: [data.item?.order ?? null, Validators.required],
      title: [data.item?.title ?? '', Validators.required],
      text: [data.item?.text ?? ''],
      ctaTitle: [data.item?.ctaTitle ?? '', Validators.required],
      ctaDestination: [data.item?.ctaDestination ?? null],
      ctaUrl: [data.item?.ctaUrl ?? ''],
      // Absent on every existing record, which reads as false - see the
      // field's own comment in home-page-image.model.ts.
      artworkHasText: [data.item?.artworkHasText ?? false]
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

  showMobileImageUploader(): void {
    this.isMobileImageUploaderVisible$.next(true);
  }

  closeMobileImageUploader(): void {
    this.isMobileImageUploaderVisible$.next(false);
  }

  /**
   * The CSS background value the preview should paint for a device, following
   * the same rule the web app applies (HomeHeaderSliderComponent
   * .slideImageUrl): a phone uses this slide's own picture when it has one and
   * otherwise falls back to the wide image; a desktop always uses the wide one.
   */
  previewImage(device: 'web' | 'phone'): string {
    const url = (device === 'phone' && this.card.mobileImage?.url) || this.card.image?.url;
    return url ? `url(${url})` : 'none';
  }

  /** Says in words what the frame is doing, so the preview is not a guess. */
  previewNote(device: 'web' | 'phone'): string {
    if (device !== 'phone') {
      return 'Desktop fills the frame with the main image.';
    }
    if (this.card.mobileImage) {
      return 'Showing this slide\x27s phone picture.';
    }
    return 'No phone picture - showing the main image fitted whole, which shrinks a wide banner.';
  }

  /** Drops the phone picture so the slide falls back to the main image. */
  clearMobileImage(): void {
    this.card.mobileImage = undefined;
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
    const value: HomePageImageModel = { ...this.data.item, ...this.form.value, image: this.card.image, mobileImage: this.card.mobileImage ?? null, date: Timestamp.now() };

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
