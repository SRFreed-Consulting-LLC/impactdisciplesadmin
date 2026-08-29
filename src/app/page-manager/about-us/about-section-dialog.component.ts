import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { BehaviorSubject } from 'rxjs';
import {
  PageContentBlock, PageContentItem
} from '@impact-common/shared/models/domain/page-content.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import menuData from 'src/app/common/services/data/nav-menu-data';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { AboutSectionKind } from './about-section-catalogue';

export interface AboutSectionDialogData {
  section: PageContentBlock;
  kind: AboutSectionKind;
}

/**
 * Edits ONE About Us section.
 *
 * One dialog for every type: which fields a type uses is declared once in
 * ABOUT_SECTION_KINDS, so a new type that reuses existing fields needs no
 * change here.
 *
 * It does NOT save. It edits a copy and hands it back on close, and the
 * stack screen writes it - because the whole page is one document and a
 * per-section write would race the ordering. That is the difference from
 * BaseEntityDialogComponent, which owns its own save; extending it here
 * would mean two writers for one document.
 *
 * Order and Live are not here either. They are single facts the stack
 * writes the moment they change.
 */
@Component({
    selector: 'app-about-section-dialog',
    templateUrl: './about-section-dialog.component.html',
    styleUrls: ['./about-section-dialog.component.css'],
    standalone: false
})
export class AboutSectionDialogComponent {
  readonly richTextModules = RICH_TEXT_TOOLBAR;

  readonly section: PageContentBlock;
  readonly kind: AboutSectionKind;

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  /** Which entry is picking a picture, or null for the section's own. */
  private target: number | null = null;
  card: { image?: ImageModel } = {};

  destinations: { text: string; value: string }[] = [];

  constructor(
    private readonly dialogRef: MatDialogRef<AboutSectionDialogComponent, PageContentBlock | undefined>,
    @Inject(MAT_DIALOG_DATA) data: AboutSectionDialogData
  ) {
    this.section = data.section;
    this.kind = data.kind;
    if (this.kind.fields.entries && !this.section.items) {
      this.section.items = [];
    }

    menuData.forEach((menu) => {
      this.destinations.push({ text: menu.title, value: menu.link });
      if (menu.hasDropdown) {
        menu.dropdownItems.forEach((dd) => {
          this.destinations.push({ text: dd.title, value: dd.link });
        });
      }
    });
    // An anchor is a real destination on this page - the story buttons all
    // point at #history, which is the banner further down.
    this.destinations.push({ text: 'The banner on this page', value: '#history' });
    this.destinations.push({ text: 'External', value: 'external' });
  }

  get fields() {
    return this.kind.fields;
  }

  get headingLabel(): string {
    return this.kind.headingLabel ?? 'Heading';
  }

  get subheadingLabel(): string {
    return this.kind.subheadingLabel ?? 'Second heading';
  }

  get imageLabel(): string {
    return this.kind.imageLabel ?? 'Picture';
  }

  // ---------------------------------------------------------- the entries

  get entries(): PageContentItem[] {
    return this.section.items ?? [];
  }

  addEntry(): void {
    this.section.items = [...this.entries, { title: '', description: '', isActive: true }];
  }

  removeEntry(index: number): void {
    this.section.items = this.entries.filter((_, i) => i !== index);
  }

  reorderEntries(event: CdkDragDrop<PageContentItem[]>): void {
    moveItemInArray(this.entries, event.previousIndex, event.currentIndex);
  }

  /** Which side this entry lands on - derived, never stored. Shown so the
   *  editor does not hide a layout rule the page applies. */
  sideOf(index: number): string {
    return index % 2 === 0 ? 'copy left' : 'copy right';
  }

  // --------------------------------------------------------- the uploader

  showImageUploader(index: number | null = null): void {
    this.target = index;
    this.card.image = index === null ? this.section.image : this.entries[index]?.image;
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    if (this.target === null) {
      this.section.image = this.card.image;
    } else if (this.entries[this.target]) {
      this.entries[this.target].image = this.card.image;
    }
    this.target = null;
    this.card.image = undefined;
    this.isImageUploaderVisible$.next(false);
  }

  clearImage(): void {
    this.section.image = undefined;
  }

  // ---------------------------------------------------------------- close

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSave(): void {
    if (this.fields.video) {
      this.section.videoId = parseVideoId(this.section.videoUrl);
    }
    this.dialogRef.close(this.section);
  }
}

/**
 * The bare YouTube id out of whatever staff pasted - a watch URL, a share
 * link, an embed URL, or an id on its own. Parsed on save so the public
 * page never has to.
 */
export function parseVideoId(input: string | undefined): string | undefined {
  const value = (input ?? '').trim();
  if (!value) {
    return undefined;
  }
  if (/^[\w-]{11}$/.test(value)) {
    return value;
  }
  const match = value.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return match ? match[1] : undefined;
}
