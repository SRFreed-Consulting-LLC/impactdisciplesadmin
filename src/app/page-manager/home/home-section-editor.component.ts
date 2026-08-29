import {
  Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output
} from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { BehaviorSubject, Subject, Subscription, debounceTime } from 'rxjs';
import {
  HomeSectionItem, HomeSectionModel
} from '@impact-common/shared/models/domain/home-section.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import menuData from 'src/app/common/services/data/nav-menu-data';
import { HomeSectionKind } from './home-section-catalogue';

export interface Destination {
  text: string;
  value: string;
}

/** Matches the page editor's - see page-section-editor.component.ts. */
const LIVE_PREVIEW_DEBOUNCE_MS = 250;

/**
 * Edits ONE home-page section.
 *
 * One editor for every type rather than six: the fields are the same handful
 * in different combinations, and which of them a type uses is declared once
 * in HOME_SECTION_KINDS. A new type that reuses existing fields needs no
 * change here at all.
 *
 * IT WAS A DIALOG UNTIL 2026-08-29, and stopped being one for the reason the
 * eleven other page editors did: a pop-up has to be small enough to float
 * over the screen, which leaves no room beside it to show what the section
 * actually looks like. The Home screen hosts it full-width now, with that one
 * section previewed live.
 *
 * IT ALSO STOPPED SAVING. It used to extend BaseEntityDialogComponent and
 * write through the service itself. The Home screen owns the write now, the
 * same way the pages stack does - one writer, and the screen already writes
 * order and Live the moment they change.
 *
 * `dirty` is what makes the preview live, and a REACTIVE form gets it almost
 * free: valueChanges covers every control. What it does not cover is the
 * things held outside the form - the picked image and the cards - so those
 * call touched() where they change.
 */
@Component({
    selector: 'app-home-section-editor',
    templateUrl: './home-section-editor.component.html',
    styleUrls: ['./home-section-editor.component.css'],
    standalone: false
})
export class HomeSectionEditorComponent implements OnChanges, OnDestroy {
  /** The WORKING COPY, owned by the Home screen. Cancelling costs nothing. */
  @Input({ required: true }) item!: HomeSectionModel;
  @Input({ required: true }) kind!: HomeSectionKind;

  /** Every change, debounced - what drives the live preview beside it. */
  @Output() dirty = new EventEmitter<HomeSectionModel>();
  @Output() save = new EventEmitter<HomeSectionModel>();
  /** `cancelled`, not `cancel`: that is a native DOM event name. */
  @Output() cancelled = new EventEmitter<void>();

  form!: FormGroup;

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  /** Index of the card whose picture is being picked, or null for the
   *  section's own. */
  private itemImageIndex: number | null = null;

  // Backs app-image-uploader's [card]/[field] inputs - the uploader writes
  // the picked file straight onto this object's `image` property.
  card: { image?: ImageModel } = {};

  /** The services cards, edited in place. Array order IS their order. */
  items: HomeSectionItem[] = [];

  destinations: Destination[] = [];

  private readonly edits = new Subject<void>();
  private formSub?: Subscription;

  constructor(private fb: FormBuilder) {
    this.edits.pipe(debounceTime(LIVE_PREVIEW_DEBOUNCE_MS))
      .subscribe(() => this.dirty.emit(this.buildValue()));

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

  // Rebuilt per section rather than once: the Home screen keeps ONE editor
  // instance and swaps which section it holds, so a form built in a
  // constructor would still be showing the first section opened.
  ngOnChanges(): void {
    this.card.image = this.item.image;
    this.items = (this.item.items ?? []).map((item) => ({ ...item }));

    // Every control is built regardless of type and the template shows only
    // what kind.fields declares. Building conditionally would mean a
    // template referring to a control that may not exist, which fails at
    // runtime rather than at build time.
    this.form = this.fb.group({
      title: [this.item.title ?? ''],
      subtitle: [this.item.subtitle ?? ''],
      ctaTitle: [this.item.ctaTitle ?? ''],
      ctaDestination: [this.item.ctaDestination ?? null],
      ctaUrl: [this.item.ctaUrl ?? ''],
      videoUrl: [this.item.videoUrl ?? '']
    });

    this.formSub?.unsubscribe();
    this.formSub = this.form.valueChanges.subscribe(() => this.touched());
  }

  ngOnDestroy(): void {
    this.formSub?.unsubscribe();
    this.edits.complete();
  }

  /**
   * Anything changed, from the form or from what the form does not hold.
   *
   * `input` on the host catches the cards' text boxes, which are standalone
   * ngModel rather than form controls - the form's own valueChanges does not
   * see them. The cards' slide toggle is a button and fires no input event,
   * so it carries an explicit output in the template; the uploader, add,
   * remove and reorder call this directly.
   */
  @HostListener('input')
  touched(): void {
    this.edits.next();
  }

  get fields() {
    return this.kind.fields;
  }

  get itemType(): string {
    return this.kind.label;
  }

  get imageLabel(): string {
    return this.kind.imageLabel ?? 'Picture';
  }

  /**
   * Everything the form does not hold: the picked image, the cards, and the
   * video id parsed out of whatever URL was pasted.
   *
   * Spreads the ORIGINAL section first so fields this type does not edit
   * (another type's leftovers, and `order`/`isActive`, which the stack owns)
   * survive a save here rather than being dropped.
   */
  buildValue(): HomeSectionModel {
    const form = this.form.value;
    return {
      ...this.item,
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
  }

  // ------------------------------------------------------------ the cards

  addItem(): void {
    this.items = [...this.items, { title: '', isActive: true }];
    this.touched();
  }

  removeItem(index: number): void {
    this.items = this.items.filter((_, i) => i !== index);
    this.touched();
  }

  reorderItems(event: CdkDragDrop<HomeSectionItem[]>): void {
    moveItemInArray(this.items, event.previousIndex, event.currentIndex);
    this.touched();
  }

  // ------------------------------------------------------- image uploader

  /** @param index a card's index, or null for the section's own picture. */
  showImageUploader(index: number | null = null): void {
    this.itemImageIndex = index;
    // The uploader writes onto card.image whichever picture is being
    // picked, so seed it with the current one and read it back on close.
    this.card.image = index === null
      ? this.item.image
      : this.items[index]?.image;
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    if (this.itemImageIndex !== null && this.items[this.itemImageIndex]) {
      this.items[this.itemImageIndex].image = this.card.image;
      // Put card.image back to the SECTION's picture - leaving a card's
      // picture there would make the section preview show the wrong one.
      this.card.image = this.item.image;
    } else {
      this.item.image = this.card.image;
    }
    this.itemImageIndex = null;
    this.isImageUploaderVisible$.next(false);
    this.touched();
  }

  /** The picture currently on the section itself, for the preview tile. */
  get sectionImage(): ImageModel | undefined {
    return this.item.image;
  }

  clearSectionImage(): void {
    this.item.image = undefined;
    this.card.image = undefined;
    this.touched();
  }

  // ---------------------------------------------------------------- close

  onCancel(): void {
    this.cancelled.emit();
  }

  onSave(): void {
    this.save.emit(this.buildValue());
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
