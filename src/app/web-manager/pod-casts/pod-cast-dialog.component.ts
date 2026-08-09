import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { PodCastModel } from 'src/app/common/models/domain/pod-cast.model';
import { PodCastService } from 'src/app/common/services/data/pod-cast.service';
import { TagModel } from 'src/app/common/models/domain/tag.model';
import { PodCastTagsService } from 'src/app/common/services/data/pod-cast-tags.service';
import { ImageModel } from 'src/app/common/models/utils/image.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { SnackbarService } from '../../shared/snackbar.service';

export interface PodCastDialogData {
  item: PodCastModel | null;
  categories: TagModel[];
  // A snapshot from the list screen's own live tag stream, same treatment
  // as `categories` - the dialog keeps its own local copy (seeded here,
  // appended to in onCreateTag()) rather than subscribing itself, since a
  // dialog-owned subscription would need its own teardown on close and
  // this lookup list rarely changes mid-edit anyway.
  tags: TagModel[];
}

@Component({
    selector: 'app-pod-cast-dialog',
    templateUrl: './pod-cast-dialog.component.html',
    styleUrls: ['./pod-cast-dialog.component.scss'],
    standalone: false
})
export class PodCastDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  videoTypes = ['Youtube', 'Apple', 'Vimeo'];
  podCastTags: TagModel[];

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // home-page-image-dialog.component.ts for the full explanation.
  card: { thumbnail?: ImageModel } = {};

  private itemType = 'Pod Cast';

  constructor(
    private dialogRef: MatDialogRef<PodCastDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: PodCastDialogData,
    private fb: FormBuilder,
    private service: PodCastService,
    private podCastTagService: PodCastTagsService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.card.thumbnail = data.item?.thumbnail;

    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      date: [dateFromTimestamp(data.item?.date) ?? new Date(), Validators.required],
      category: [data.item?.category ?? null, Validators.required],
      title: [data.item?.title ?? '', Validators.required],
      videoType: [data.item?.videoType ?? null, Validators.required],
      videoId: [data.item?.videoId ?? '', Validators.required],
      tags: [data.item?.tags ?? []]
    });

    this.podCastTags = [...data.tags];
  }

  showImageUploader(): void {
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    this.isImageUploaderVisible$.next(false);
  }

  // Mirrors the original's onCustomItemCreating: a tag typed that doesn't
  // match any existing option becomes a brand new pod_cast_tags record
  // (persisted here, not by app-tag-chips - see its own comment on why),
  // then gets added to the current selection through the form control like
  // any other selected tag.
  onCreateTag(name: string): void {
    const tag: TagModel = { ...new TagModel(), tag: name, id: this.generateRandomId() };
    this.podCastTagService.update(tag.id!, tag);
    this.podCastTags = [...this.podCastTags, tag];

    const current: TagModel[] = this.form.value.tags ?? [];
    this.form.patchValue({ tags: [...current, tag] });
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
    const value: PodCastModel = { ...this.data.item, ...this.form.value, thumbnail: this.card.thumbnail };

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

  private generateRandomId(): string {
    return 'xxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
