import { Component, Inject } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { BehaviorSubject } from 'rxjs';
import {
  HomeSectionItem, HomeSectionModel
} from '@impact-common/shared/models/domain/home-section.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { HomeSectionService } from 'src/app/common/services/data/home-sections.service';
import menuData from 'src/app/common/services/data/nav-menu-data';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../shared/base-entity-dialog.component';
import { HomeSectionKind } from './home-section-catalogue';

export interface HomeSectionDialogData {
  /** Named `item` because BaseEntityDialogComponent keys isEdit off data.item.id. */
  item: HomeSectionModel;
  kind: HomeSectionKind;
}

export interface Destination {
  text: string;
  value: string;
}

/**
 * Edits ONE home-page section.
 *
 * One dialog for every type rather than six: the fields are the same handful
 * in different combinations, and which of them a type uses is declared once
 * in HOME_SECTION_KINDS. A new type that reuses existing fields needs no
 * change here at all.
 *
 * Order and Live are NOT here. They are single facts about a section that
 * the stack screen writes the moment they change, so putting them behind
 * this dialog's SAVE would mean two ways to do the same thing.
 */
@Component({
    selector: 'app-home-section-dialog',
    templateUrl: './home-section-dialog.component.html',
    styleUrls: ['./home-section-dialog.component.css'],
    standalone: false
})
export class HomeSectionDialogComponent extends BaseEntityDialogComponent<HomeSectionModel> {
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  /** Index of the card whose picture is being picked, or null for the section's own. */
  private itemImageIndex: number | null = null;

  // Backs app-image-uploader's [card]/[field] inputs - the uploader writes
  // the picked file straight onto this object's `image` property.
  card: { image?: ImageModel } = {};

  /** The services cards, edited in place. Array order IS their order. */
  items: HomeSectionItem[] = [];

  destinations: Destination[] = [];

  readonly itemType: string;

  constructor(
    protected readonly dialogRef: MatDialogRef<HomeSectionDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: HomeSectionDialogData,
    private fb: FormBuilder,
    protected readonly service: HomeSectionService,
    protected readonly snackbar: SnackbarService
  ) {
    super();
    this.itemType = data.kind.label;
    this.card.image = data.item.image;
    this.items = (data.item.items ?? []).map((item) => ({ ...item }));

    // Every control is built regardless of type and the template shows only
    // what kind.fields declares. Building conditionally would mean a
    // template referring to a control that may not exist, which fails at
    // runtime rather than at build time.
    this.form = this.fb.group({
      title: [data.item.title ?? ''],
      subtitle: [data.item.subtitle ?? ''],
      ctaTitle: [data.item.ctaTitle ?? ''],
      ctaDestination: [data.item.ctaDestination ?? null],
      ctaUrl: [data.item.ctaUrl ?? ''],
      videoUrl: [data.item.videoUrl ?? '']
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

  get fields() {
    return this.data.kind.fields;
  }

  get imageLabel(): string {
    return this.data.kind.imageLabel ?? 'Picture';
  }

  /**
   * Everything the form does not hold: the picked image, the cards, and the
   * video id parsed out of whatever URL was pasted.
   *
   * Spreads the ORIGINAL section first so fields this type does not edit
   * (another type's leftovers, and `order`/`isActive`, which the stack owns)
   * survive a save here rather than being dropped.
   */
  protected override buildValue(): HomeSectionModel {
    const form = this.form.value;
    const value: HomeSectionModel = {
      ...this.data.item,
      ...(this.fields.title ? { title: form.title } : {}),
      ...(this.fields.subtitle ? { subtitle: form.subtitle } : {}),
      ...(this.fields.image ? { image: this.card.image } : {}),
      ...(this.fields.cta ? {
        ctaTitle: form.ctaTitle,
        ctaDestination: form.ctaDestination,
        ctaUrl: form.ctaUrl
      } : {}),
      ...(this.fields.video ? {
        videoUrl: form.videoUrl,
        videoId: parseVideoId(form.videoUrl)
      } : {}),
      ...(this.fields.items ? { items: this.items } : {})
    } as HomeSectionModel;

    return value;
  }

  // ------------------------------------------------------------ the cards

  addItem(): void {
    this.items = [...this.items, { title: '', isActive: true }];
  }

  removeItem(index: number): void {
    this.items = this.items.filter((_, i) => i !== index);
  }

  reorderItems(event: CdkDragDrop<HomeSectionItem[]>): void {
    moveItemInArray(this.items, event.previousIndex, event.currentIndex);
  }

  // ------------------------------------------------------- image uploader

  /** @param index a card's index, or null for the section's own picture. */
  showImageUploader(index: number | null = null): void {
    this.itemImageIndex = index;
    // The uploader writes onto card.image whichever picture is being
    // picked, so seed it with the current one and read it back on close.
    this.card.image = index === null
      ? this.data.item.image
      : this.items[index]?.image;
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    if (this.itemImageIndex !== null && this.items[this.itemImageIndex]) {
      this.items[this.itemImageIndex].image = this.card.image;
      // Put card.image back to the SECTION's picture - leaving a card's
      // picture there would make the section preview show the wrong one.
      this.card.image = this.data.item.image;
    } else {
      this.data.item.image = this.card.image;
    }
    this.itemImageIndex = null;
    this.isImageUploaderVisible$.next(false);
  }

  /** The picture currently on the section itself, for the preview tile. */
  get sectionImage(): ImageModel | undefined {
    return this.data.item.image;
  }

  clearSectionImage(): void {
    this.data.item.image = undefined;
    this.card.image = undefined;
  }
}

/**
 * The bare YouTube id out of whatever staff pasted - a watch URL, a share
 * link, an embed URL, or an id on its own.
 *
 * Parsed on SAVE so the public page never has to: it stores the id beside
 * the URL, and <youtube-player> takes an id.
 */
export function parseVideoId(input: string | undefined): string | undefined {
  const value = (input ?? '').trim();
  if (!value) {
    return undefined;
  }
  // An id on its own: 11 chars of the YouTube alphabet, no separators.
  if (/^[\w-]{11}$/.test(value)) {
    return value;
  }
  const match = value.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return match ? match[1] : undefined;
}
