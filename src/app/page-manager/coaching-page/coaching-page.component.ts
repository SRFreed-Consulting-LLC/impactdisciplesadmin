import { Component, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { CoachingPageModel, CoachingScreenshot } from '@impact-common/shared/models/domain/coaching-page.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { TestimonialModel } from '@impact-common/shared/models/domain/testimonial.model';
import { TESTIMONIAL_TYPES } from '@impact-common/shared/lists/testimonial_types.enum';
import { CoachingPageService } from 'src/app/common/services/data/coaching-page.service';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { TestimonialDialogComponent } from '../testimonials/testimonial-dialog.component';
import { parseVideoUrl } from '../../tools-manager/email-designer/video-url.util';

/**
 * COACHING WITH IMPACT - the editable content of that public page.
 *
 * A settings screen, not a list: one record (see CoachingPageService), saved
 * in place. Three things, which is exactly what staff asked for and no more -
 * the hero, book covers, group photo and outbound links stay in code.
 *
 * TESTIMONIALS are ONE LIST of every coaching-typed record, in the order the
 * page shows them. Two things are deliberately separate here:
 *
 *   - ORDER is this page's business, and lives in the config's testimonialIds.
 *   - WHETHER A QUOTE APPEARS is the testimonial's own `isActive`, which is
 *     the same Live switch the Testimonials screen and the edit dialog use.
 *     So the toggle on a row writes to the TESTIMONIAL, immediately, not to
 *     this page's config - which is why it saves on the spot rather than
 *     waiting for SAVE. SAVE writes the page: order, video, screenshots.
 */
@Component({
  selector: 'app-coaching-page',
  templateUrl: './coaching-page.component.html',
  styleUrls: ['./coaching-page.component.css'],
  standalone: false
})
export class CoachingPageComponent implements OnInit {
  readonly itemType = 'Coaching with Impact';

  private readonly screenKey = 'page-manager.coaching-with-impact';

  config: CoachingPageModel = new CoachingPageModel();

  /** Every coaching-typed testimonial, in the order the page shows them. */
  testimonials: TestimonialModel[] = [];

  /** What staff typed. Parsed to an id on save, not on every keystroke. */
  videoUrl = '';
  videoError = '';

  /**
   * The video the CURRENT field text points at, so the preview follows what
   * is typed rather than what was last saved - the whole point is to see
   * which video you are about to set before you set it. Null while the text
   * is not a YouTube link, which is also how the thumbnail disappears the
   * moment a URL stops being valid.
   */
  previewVideoId: string | null = null;
  previewThumbnail: string | null = null;
  /** Thumbnail until clicked, then a real player - keeps an iframe off the
   *  screen until it is wanted. */
  videoPlaying = false;

  spinnerVisible = false;

  /** Shown when a read failed, so an empty screen is never mistaken for
   *  "nothing configured yet" - saving over that would lose real content. */
  loadError = '';

  /** Backs app-image-uploader's [card]/[field] pair - it writes the chosen
   *  ImageModel onto card[field], so the screenshot being edited is bounced
   *  through here and read back when the picker closes. */
  card: { image?: ImageModel } = {};
  uploaderVisibleFor: number | null = null;

  constructor(
    private service: CoachingPageService,
    private testimonialService: TestimonialService,
    private permissionService: PermissionService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private dialog: MatDialog,
    private sanitizer: DomSanitizer
  ) {}

  async ngOnInit(): Promise<void> {
    // Settled, not Promise.all: these are two independent reads, and one
    // failing must not blank the other. Learned the hard way - before
    // `coaching_page` had a rule, its rejection took the testimonial list
    // down with it and the whole screen came up empty with no clue why.
    const [configResult, testimonialResult] = await Promise.allSettled([
      this.service.get(),
      this.testimonialService.getAllByValue('type', TESTIMONIAL_TYPES.COACHING)
    ]);

    if (testimonialResult.status === 'rejected') {
      console.error('Coaching page: could not read testimonials', testimonialResult.reason);
      this.loadError = 'Could not load the testimonial list.';
    }
    if (configResult.status === 'rejected') {
      console.error('Coaching page: could not read the page config', configResult.reason);
      this.loadError = 'Could not load this page\'s saved settings.';
    }

    const rows = testimonialResult.status === 'fulfilled' ? (testimonialResult.value ?? []) : [];
    const config = configResult.status === 'fulfilled' ? configResult.value : undefined;

    if (config) {
      this.config = { ...new CoachingPageModel(), ...config };
      this.config.testimonialIds = config.testimonialIds ?? [];
      this.config.screenshots = (config.screenshots ?? []).slice().sort((a, b) => a.order - b.order);
      this.videoUrl = config.videoUrl ?? '';
    }

    this.orderTestimonials(rows);
    this.onVideoUrlChange();
  }

  // ------------------------------------------------------------ testimonials

  /**
   * Puts the list in the page's order.
   *
   * Ids the config knows come first, in its order; anything else is appended.
   * That second half matters - a coach testimonial added from the Testimonials
   * screen, or by someone else since this config was saved, has no place in
   * the stored order and would otherwise be invisible here.
   */
  private orderTestimonials(rows: TestimonialModel[]): void {
    const byId = new Map(rows.map((t) => [t.id, t]));

    const known = this.config.testimonialIds
      .map((id) => byId.get(id))
      .filter((t): t is TestimonialModel => !!t);

    const knownIds = new Set(known.map((t) => t.id));
    const rest = rows
      .filter((t) => !knownIds.has(t.id))
      .sort((a, b) => (a.author ?? '').localeCompare(b.author ?? ''));

    this.testimonials = [...known, ...rest];
    this.syncOrder();
  }

  /** The list's sequence IS the page's order. */
  private syncOrder(): void {
    this.config.testimonialIds = this.testimonials.map((t) => t.id);
  }

  reorder(event: CdkDragDrop<TestimonialModel[]>): void {
    moveItemInArray(this.testimonials, event.previousIndex, event.currentIndex);
    this.syncOrder();
  }

  /** How many will actually appear - the count staff care about. */
  get liveCount(): number {
    return this.testimonials.filter((t) => t.isActive).length;
  }

  /** A short opening for the row - the full text is long enough that showing
   *  it whole would make the list unusable. */
  preview(testimonial: TestimonialModel): string {
    const text = (testimonial.text ?? '').trim();
    return text.length > 150 ? `${text.slice(0, 150)}…` : text;
  }

  /** Paragraph count, so the list shows at a glance which quotes are long -
   *  the same blank-line split the public page uses. */
  paragraphCount(testimonial: TestimonialModel): number {
    const text = (testimonial.text ?? '').trim();
    if (!text) {
      return 0;
    }
    return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
  }

  /**
   * Live is a property of the TESTIMONIAL, not of this page, so it is written
   * straight away rather than waiting for SAVE - SAVE writes the page config,
   * and it would be a surprise for it to also rewrite seven other records.
   */
  async toggleLive(testimonial: TestimonialModel): Promise<void> {
    const next = !testimonial.isActive;
    testimonial.isActive = next;

    try {
      await this.testimonialService.update(testimonial.id, testimonial);
      this.snackbar.success(next ? 'Showing on the page' : 'Taken off the page');
    } catch (err) {
      console.error('Coaching page: could not change Live', err);
      testimonial.isActive = !next; // put the switch back - the write failed
      this.snackbar.error('Could not change that - try again');
    }
  }

  // -------------------------------------------------- adding and editing here

  /**
   * Adds a NEW testimonial without leaving this screen.
   *
   * Reuses the Testimonials screen's own dialog rather than a second editor:
   * one form, one set of validation, one place a field gets added. It seeds
   * the type so a coach quote created here does not land untyped and vanish
   * from this screen's list, and asks the dialog for the coaching preview.
   */
  async addNew(): Promise<void> {
    const saved = await this.openDialog({
      type: TESTIMONIAL_TYPES.COACHING,
      isActive: true
    } as TestimonialModel);

    if (saved) {
      await this.reloadTestimonials();
    }
  }

  /**
   * Deletes the testimonial itself, not just its place on this page.
   *
   * These are shared records, so this is a real deletion and the confirm says
   * so plainly - "take it off the page" is what the Live switch is for, and
   * someone reaching for delete when they meant that would otherwise lose a
   * coach's words with no undo. `canDelete` is checked rather than `canEdit`:
   * removing a record is its own permission.
   */
  async remove(testimonial: TestimonialModel): Promise<void> {
    if (!this.canDelete()) {
      return;
    }

    const who = testimonial.author || 'this testimonial';
    const confirmed = await this.confirmService.confirm(
      `<i>Delete ${who}'s testimonial for good?</i><br><br>` +
        'It disappears from every page that uses it. To take it off this page only, ' +
        'switch <b>Live</b> off instead.',
      'Delete testimonial'
    );
    if (!confirmed) {
      return;
    }

    try {
      await this.testimonialService.delete(testimonial.id);
      this.testimonials = this.testimonials.filter((t) => t.id !== testimonial.id);
      this.syncOrder();
      this.snackbar.success('Testimonial deleted');
    } catch (err) {
      console.error('Coaching page: could not delete the testimonial', err);
      this.snackbar.error('Could not delete that - try again');
    }
  }

  /** Edits the shared record. The same quote on any other page changes too -
   *  which is the point of it being one record rather than a copy. */
  async edit(testimonial: TestimonialModel): Promise<void> {
    const saved = await this.openDialog(testimonial);
    if (saved) {
      await this.reloadTestimonials();
    }
  }

  private async openDialog(item: TestimonialModel): Promise<boolean> {
    const ref = this.dialog.open(TestimonialDialogComponent, {
      width: '1180px',
      maxWidth: '96vw',
      data: { item }
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /** Re-reads after the dialog wrote one, so the list and its order reflect
   *  the change without a page reload. */
  private async reloadTestimonials(): Promise<void> {
    try {
      const rows = await this.testimonialService.getAllByValue('type', TESTIMONIAL_TYPES.COACHING);

      // The dialog can change TYPE. A quote retyped away from Coaching is no
      // longer a coach testimonial, so it drops out of the list and out of the
      // order rather than leaving an id that resolves to nothing. Only ever
      // after a SUCCESSFUL read - pruning on a failed one would throw away a
      // real ordering.
      this.orderTestimonials(rows ?? []);
    } catch (err) {
      console.error('Coaching page: could not reload testimonials', err);
      this.snackbar.error('Saved, but the list could not be refreshed - reload the screen.');
    }
  }

  // ------------------------------------------------------------ video preview

  /**
   * Re-derives the preview from the field on every change. Deliberately
   * separate from applyVideoUrl(), which validates and writes to the config
   * on SAVE: this one is allowed to silently show nothing while someone is
   * half way through typing a URL, where an error message would just nag.
   */
  onVideoUrlChange(): void {
    const parsed = parseVideoUrl(this.videoUrl.trim());
    const isYouTube = parsed.provider === 'youtube' && !!parsed.videoId;

    this.previewVideoId = isYouTube ? parsed.videoId : null;
    this.previewThumbnail = isYouTube ? parsed.thumbnailUrl : null;
    this.videoPlaying = false;

    // Typing over a bad URL should clear the complaint, not keep it on screen.
    if (isYouTube) {
      this.videoError = '';
    }
  }

  playPreview(): void {
    this.videoPlaying = true;
  }

  /**
   * The embed URL for the preview player.
   *
   * bypassSecurityTrustResourceUrl is safe HERE and only here: the id is not
   * user text, it is what parseVideoUrl's own [A-Za-z0-9_-] match produced, so
   * nothing a person types can escape the youtube.com/embed/ path. Never widen
   * this to take the raw field.
   */
  embedUrl(): SafeResourceUrl | null {
    if (!this.previewVideoId) {
      return null;
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube.com/embed/${this.previewVideoId}?rel=0`
    );
  }

  watchOnYouTube(): string {
    return `https://www.youtube.com/watch?v=${this.previewVideoId}`;
  }

  private applyVideoUrl(): boolean {
    const raw = this.videoUrl.trim();
    this.videoError = '';

    if (!raw) {
      this.config.videoUrl = undefined;
      this.config.videoId = undefined;
      return true;
    }

    // Reuses the email designer's parser rather than a second regex - it
    // already knows watch?v=, youtu.be, /shorts/ and vimeo.
    const parsed = parseVideoUrl(raw);
    if (parsed.provider !== 'youtube' || !parsed.videoId) {
      this.videoError = parsed.provider === 'vimeo'
        ? 'This page plays YouTube only - a Vimeo link will not render.'
        : 'That does not look like a YouTube link. Paste the watch, youtu.be or shorts URL.';
      return false;
    }

    this.config.videoUrl = raw;
    this.config.videoId = parsed.videoId;
    return true;
  }

  // ------------------------------------------------------------- screenshots

  addScreenshot(): void {
    const nextOrder = this.config.screenshots.reduce((max, s) => Math.max(max, s.order), -1) + 1;
    this.config.screenshots = [
      ...this.config.screenshots,
      { order: nextOrder, isActive: true }
    ];
  }

  removeScreenshot(index: number): void {
    this.config.screenshots = this.config.screenshots.filter((_, i) => i !== index);
    this.renumber();
  }

  reorderScreenshots(event: CdkDragDrop<CoachingScreenshot[]>): void {
    moveItemInArray(this.config.screenshots, event.previousIndex, event.currentIndex);
    this.renumber();
  }

  /** `order` is what the public page sorts on, so it is rewritten from the
   *  list's actual sequence on every change - that is what stops two rows
   *  sharing a number the way the home slider's did. */
  private renumber(): void {
    this.config.screenshots.forEach((shot, i) => (shot.order = i));
  }

  openUploader(index: number): void {
    this.card = { image: this.config.screenshots[index].image };
    this.uploaderVisibleFor = index;
  }

  closeUploader(): void {
    if (this.uploaderVisibleFor !== null) {
      this.config.screenshots[this.uploaderVisibleFor].image = this.card.image;
    }
    this.uploaderVisibleFor = null;
  }

  // -------------------------------------------------------------------- save

  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  /** Deleting a record is its own permission, not part of editing one. */
  canDelete(): boolean {
    return this.permissionService.canDelete(this.screenKey);
  }

  async save(): Promise<void> {
    // A screen that failed to load shows empty fields, and saving those would
    // write the emptiness over real content. Refuse rather than trust it.
    if (this.loadError) {
      this.snackbar.error('Not saved - this screen did not load properly. Reload and try again.');
      return;
    }

    if (!this.applyVideoUrl()) {
      return;
    }

    this.syncOrder();
    this.renumber();
    this.spinnerVisible = true;
    try {
      await this.service.save(this.config);
      this.snackbar.success('Coaching with Impact page saved');
    } catch (err) {
      console.error('Coaching page save failed:', err);
      this.snackbar.error('Could not save the page');
    } finally {
      this.spinnerVisible = false;
    }
  }
}
