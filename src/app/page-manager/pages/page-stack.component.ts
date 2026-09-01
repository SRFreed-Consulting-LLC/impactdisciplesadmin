import { Component, Input, OnChanges, inject } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { BehaviorSubject } from 'rxjs';
import { PageContentBlock, PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { EditablePage, PageSectionKind, kindFor, pluralise } from './page-section-catalogue';
import { SECTION_ARCHETYPE } from '@impact-common/shared/lists/section_kit';

/**
 * ONE public page as an ordered stack of sections, with a live preview of the
 * whole page beside it.
 *
 * The same screen for all eleven, driven by that page's entry in
 * EDITABLE_PAGES. It is the shape the Home screen and About Us proved, and
 * for the same reason: every public page is a dispatcher that renders
 * whatever this list says in this order, so the running order is what staff
 * most need to see and change.
 *
 * IT REPLACED A SLOT EDITOR, which is the point of the exercise. That screen
 * showed a fixed set of named boxes - "Overview", "Cost", "Are you ready?" -
 * because the page's structure lived in its template and only its words were
 * editable. Ten of these pages could not gain a section, lose one, or put two
 * in a different order without a deploy. They can now.
 *
 * ORDER IS NEVER TYPED. Dropping a section reorders the array and saves; the
 * array's order IS the page's order. Nothing carries a number that could
 * disagree with its position.
 *
 * WHAT SAVES WHEN, separated on purpose:
 *   - REORDER and the LIVE toggle write immediately. They are single facts
 *     about the page, and a screen-level Save that quietly rewrote seven
 *     sections would be a surprise.
 *   - CONTENT is edited in a dialog, which hands back one section.
 *
 * A screen whose load FAILED refuses to save - saving over content it never
 * read is how a page gets silently emptied, and since these documents are
 * now the ONLY copy of a page's words there is nothing to fall back to.
 */
@Component({
  selector: 'app-page-stack',
  templateUrl: './page-stack.component.html',
  styleUrls: ['./page-stack.component.css'],
  standalone: false
})
export class PageStackComponent implements OnChanges {
  private readonly service = inject(PageContentService);
  private readonly permissionService = inject(PermissionService);
  private readonly confirmService = inject(ConfirmService);
  private readonly snackbar = inject(SnackbarService);

  @Input({ required: true }) page!: EditablePage;

  /** Whether the PAGE is on the site. Only used to say when a live page has
   *  nothing switched on to draw - see `publishedButBlank`. */
  @Input() isPublished = false;

  sections: PageContentBlock[] = [];

  loading = true;
  loadFailed = false;
  readonly busy$ = new BehaviorSubject<boolean>(false);

  /**
   * Bumped after every successful write, which reloads the previewer.
   *
   * The preview is the REAL page in a frame now, so it shows what is saved -
   * and everything on this screen saves the moment it changes, so a reload
   * per write is the whole synchronisation story. A cross-origin frame
   * cannot be told to refresh itself; changing its src is the only way.
   */
  previewRevision = 0;

  /**
   * The section being edited full-screen, or null for the stack.
   *
   * A WORKING COPY, not the row: cancelling has to cost nothing, and the
   * preview beside it shows this rather than what is stored.
   */
  editing: PageContentBlock | null = null;
  editingKind: PageSectionKind | null = null;

  /**
   * The same object, re-referenced on every keystroke.
   *
   * The previewer takes it as an @Input, and Angular only notices an input
   * change when the REFERENCE changes - mutating `editing` in place would
   * post nothing. So the editor's debounced output lands here as a shallow
   * copy, which is also what gets posted into the frame.
   */
  editingLive: PageContentBlock | null = null;

  // ngOnChanges, not ngOnInit. Today Page Manager gives each tab its own @if,
  // so switching pages destroys this component and builds another - and
  // ngOnChanges fires before ngOnInit on creation, so nothing is lost either
  // way. It is written this way so that REBINDING `page` on a live instance
  // also reloads: with ngOnInit that would leave the previous page's sections
  // on screen under the new page's name, and the next save would write them
  // to the new page's document.
  ngOnChanges(): void {
    this.load();
  }

  private get screenKey(): string {
    return `page-manager.${this.page.slug}`;
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.sections = [];
    try {
      const doc = await this.service.getById(this.page.slug);
      this.sections = (doc?.blocks ?? []).map((b) => ({ ...b }));
      this.loadFailed = false;
    } catch (err) {
      console.error(`${this.page.label}: could not load the page`, err);
      this.loadFailed = true;
      this.snackbar.error('Could not load this page - reload before editing');
    } finally {
      this.loading = false;
    }
  }

  /**
   * Writes the whole ordered list. The array IS the order.
   *
   * A PARTIAL write, and it has to be. This used to call `service.update()`,
   * which is `setDoc` with no merge - a whole-document overwrite. That was
   * harmless while every document held nothing but `blocks`, and became
   * destructive the moment pages staff create arrived: those also carry
   * `title`, `theme` and `isPublished`, and the first section anybody saved
   * would have wiped all three. Losing `title` is not cosmetic - it is what
   * marks a document as a builder page, so the page would have 404'd.
   *
   * `updateFields` rejects if the document does not exist, which is the
   * behaviour we want either way: this screen already refuses to save when
   * its load failed, rather than writing over content it never read.
   */
  private async persist(message: string): Promise<void> {
    this.busy$.next(true);
    try {
      await this.service.updateFields(this.page.slug, { blocks: this.sections });
      this.previewRevision++;
      this.snackbar.success(message);
    } catch (err) {
      console.error(`${this.page.label}: could not save`, err);
      this.snackbar.error('Could not save that - reload and try again');
      await this.load();
    } finally {
      this.busy$.next(false);
    }
  }

  // ------------------------------------------------------------------ order

  /**
   * TWO DROPS, told apart by where the drag started: a reorder of the page,
   * or a new section dragged down out of the bar.
   *
   * A DROPPED SECTION DOES NOT OPEN. Clicking one still does, because that
   * is what the Add button always did and there is nowhere else the click
   * could mean - but dragging is how you LAY A PAGE OUT, and being thrown
   * into an editor after every drop makes laying three sections out into
   * three round trips.
   */
  async dropIntoStack(event: CdkDragDrop<PageContentBlock[]>): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }
    if (event.previousContainer.id === 'section-palette') {
      await this.placeMember(event.item.data as PageSectionKind, event.currentIndex, false);
      return;
    }
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    moveItemInArray(this.sections, event.previousIndex, event.currentIndex);
    await this.persist('Order saved');
  }

  // ----------------------------------------------------------------- toggle

  async toggleLive(section: PageContentBlock): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }
    const next = section.isActive === false;
    section.isActive = next;
    await this.persist(next ? 'Showing on the page' : 'Taken off the page');
  }

  // ------------------------------------------------------- add, edit, remove

  get addableKinds(): PageSectionKind[] {
    const placed = new Set(this.sections.map((s) => s.type));
    return this.page.kinds.filter((k) => !k.singleton || !placed.has(k.type));
  }

  /**
   * The ready-made arrangements, offered ONLY on a page whose kit knows what
   * a Section is.
   *
   * The twelve original pages declare their own fixed kinds and must not
   * grow a menu of things they cannot draw.
   */
  /**
   * THE TWO MEMBERS, and nothing else.
   *
   * A Section is one to three columns of whatever you put in them; a List is
   * one item shape repeated. Everything on the site is one or the other,
   * which is the whole point of the consolidation - so the bar says exactly
   * that rather than implying a dozen kinds of thing.
   *
   * PRESETS LIVED HERE UNTIL 2026-08-31: twelve ready-made arrangements -
   * Hero, Text with a video, Call to action - each placing a Section already
   * carrying its columns and styling. They existed as the answer to "a
   * freeform builder makes building a hero from scratch tedious", and the
   * piece palette answered that better: you drag a Section in, then drag a
   * heading, some text and buttons into it. Shane's call, and the right one -
   * a preset is a shortcut for a problem that no longer exists, and twelve of
   * them on the bar made two members look like twelve types.
   */
  get addableMembers(): PageSectionKind[] {
    return this.page.kinds.filter(
      (kind) => kind.type === SECTION_ARCHETYPE.SECTION || kind.type === SECTION_ARCHETYPE.LIST
    );
  }

  /** The CLICK path, and the only one a keyboard can take: appended to the
   *  end and opened, exactly as the Add button behaved. */
  async addMember(kind: PageSectionKind): Promise<void> {
    await this.placeMember(kind, this.sections.length, true);
  }

  /**
   * Place an EMPTY member at a position.
   *
   * A Section arrives with one empty column, because a Section with no
   * columns has nowhere to drop a piece and would read as broken. A List
   * arrives on its first look, which its own Look control then changes.
   *
   * Switched OFF either way: nothing reaches the live site until staff say
   * so, which is the rule every added section has always followed.
   */
  private async placeMember(
    kind: PageSectionKind, at: number, thenEdit: boolean
  ): Promise<void> {
    if (!this.canEdit() || this.loadFailed || !kind) {
      return;
    }
    const isSection = kind.type === SECTION_ARCHETYPE.SECTION;
    const section: PageContentBlock = {
      key: uniqueKey(kind.type, this.sections),
      type: kind.type,
      variant: kind.variants?.[0]?.key,
      isActive: false,
      ...(isSection ? { columns: [{ key: 'col-1', pieces: [] }] } : { items: [] })
    };
    // CLAMPED: a drop index comes from the CDK, and an out-of-range splice
    // appends silently - which reads as the drop having been ignored.
    const next = [...this.sections];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, section);
    this.sections = next;
    await this.persist(kind.label + ' added - switch it on when it is ready');
    if (thenEdit) {
      this.edit(section);
    }
  }


  async add(kind: PageSectionKind): Promise<void> {
    if (!this.canEdit() || this.loadFailed) {
      return;
    }
    // Appended rather than inserted: a new section appearing in the middle of
    // the page unannounced is worse than one staff then drag.
    const section: PageContentBlock = {
      key: uniqueKey(kind.type, this.sections),
      type: kind.type,
      isActive: false,
      ...(kind.fields.entries ? { items: [] } : {})
    };
    this.sections = [...this.sections, section];
    await this.persist(`${kind.label} added - switch it on when it is ready`);

    // A section with nothing to edit has no dialog to open.
    if (this.isEditable(kind)) {
      this.edit(section);
    }
  }

  /**
   * Double-clicking a row opens it.
   *
   * IGNORES the controls that are not "open this". Delete and the live
   * toggle sit inside the same row, and a double-click landing on either
   * would otherwise open the editor on top of what it just did - so the
   * handler checks what was actually hit rather than asking every control
   * to stop the event, which is the version somebody forgets to do on the
   * next control they add.
   */
  editFromRow(section: PageContentBlock, event: Event): void {
    const hit = event.target as HTMLElement | null;
    if (hit?.closest('button, mat-slide-toggle, .ps__grip')) {
      return;
    }
    this.edit(section);
  }

  /**
   * Opens the section FULL SCREEN rather than in a pop-up.
   *
   * It was a dialog until 2026-08-29. A pop-up has to be small enough to
   * float over the screen, which meant a rich-text box at 220px and a
   * seven-passage list scrolling inside a scroller - and no room beside it to
   * show what the section actually looks like.
   */
  edit(section: PageContentBlock): void {
    const kind = this.kindOf(section);
    if (!kind || !this.isEditable(kind) || !this.canEdit() || this.loadFailed) {
      return;
    }
    this.editingKind = kind;
    this.editing = structuredClone(section);
    this.editingLive = { ...this.editing };
  }

  /** Every keystroke, debounced by the editor. A new REFERENCE each time, or
   *  the previewer would not see an input change - see editingLive. */
  onEditing(section: PageContentBlock): void {
    this.editingLive = { ...section };
  }

  closeEditor(): void {
    this.editing = null;
    this.editingKind = null;
    this.editingLive = null;
  }

  async saveEditor(saved: PageContentBlock): Promise<void> {
    const label = this.editingKind?.label ?? 'Section';
    // The editor edits a COPY and hands it back; this screen owns the write,
    // because the document holds every section and a per-section save would
    // race the ordering.
    const i = this.sections.findIndex((s) => s.key === saved.key);
    if (i >= 0) {
      this.sections[i] = saved;
      await this.persist(`${label} saved`);
    }
    this.closeEditor();
  }

  async remove(section: PageContentBlock): Promise<void> {
    if (!this.canDelete() || this.loadFailed) {
      return;
    }
    const kind = this.kindOf(section);
    const ok = await this.confirmService.confirm(
      'It is removed from the page and its words and pictures are gone for good. ' +
      'To take it off the page but keep it, switch Live off instead.',
      `Delete this ${kind?.label ?? 'section'}?`
    );
    if (!ok) {
      return;
    }
    this.sections = this.sections.filter((s) => s.key !== section.key);
    await this.persist(`${kind?.label ?? 'Section'} deleted`);
  }

  // ----------------------------------------------------------------- display

  kindOf(section: PageContentBlock): PageSectionKind | undefined {
    return kindFor(this.page, section.type);
  }

  /** A section with no fields of its own - the consultation banner - can be
   *  moved and switched off but has nothing to open. */
  isEditable(kind: PageSectionKind): boolean {
    // A SECTION'S CONTENT IS ITS COLUMNS, not its fields - it declares none,
    // deliberately. "Has fields" was the right question while a section WAS
    // its fields; asking only that would report the one member that replaces
    // eight of them as "nothing to edit" and refuse to open it.
    if (kind.type === SECTION_ARCHETYPE.SECTION) {
      return true;
    }
    return Object.keys(kind.fields).length > 0;
  }

  /** One line saying what this section actually holds. */
  summary(section: PageContentBlock): string {
    const kind = this.kindOf(section);
    if (kind && !this.isEditable(kind)) {
      return 'nothing to edit - move it or switch it off';
    }
    // A SECTION'S heading is a PIECE, not a field, so the field-reading path
    // below would call a full section "nothing in it yet" - the row would
    // look empty while carrying the whole band.
    if (section.columns?.length) {
      const pieces = section.columns.flatMap((column) => column.pieces ?? []);
      const heading = pieces.find((piece) => piece.kind === 'heading' && piece.text);
      const counted = `${section.columns.length} `
        + pluralise('column', section.columns.length)
        + `, ${pieces.length} ${pluralise('piece', pieces.length)}`;
      return heading?.text ? `${plain(heading.text)} — ${counted}` : counted;
    }
    if (section.items) {
      const noun = kind?.entry?.noun ?? 'entry';
      const live = section.items.filter((i) => i.isActive).length;
      const n = section.items.length;
      const counted = `${n} ${pluralise(noun, n)}` + (live === n ? '' : `, ${live} showing`);
      // A block with entries usually has a heading too, and the heading is
      // what staff recognise the row by.
      const heading = plain(section.heading);
      return heading ? `${heading} — ${counted}` : counted;
    }
    const heading = plain(section.heading);
    if (heading) {
      return heading;
    }
    const body = plain(section.body);
    return body ? body.slice(0, 60) + (body.length > 60 ? '…' : '') : 'nothing in it yet';
  }

  isLive(section: PageContentBlock): boolean {
    return section.isActive !== false;
  }

  get liveCount(): number {
    return this.sections.filter((s) => this.isLive(s)).length;
  }

  /** What the public page would draw - the preview shows exactly this. */
  get liveSections(): PageContentBlock[] {
    return this.sections.filter((s) => this.isLive(s));
  }

  /**
   * A page that IS on the site but has nothing switched on to draw.
   *
   * The gap somebody falls into on their first page (2026-09-01): a section
   * is added switched OFF on purpose, so half-written work never reaches the
   * site. But then they fill it in, save it, turn the page on - and the
   * public page is still blank, because the section's own Live toggle is a
   * separate thing on a row they have scrolled past. The empty-page message
   * does not fire either, since the page is not empty.
   *
   * Nothing here changes what is stored; it only says so out loud.
   */
  get publishedButBlank(): boolean {
    return !this.loading && !this.loadFailed
      && this.isPublished && this.sections.length > 0 && this.liveCount === 0;
  }

  /**
   * How many PAGE-LEVEL headings the live sections carry.
   *
   * THE GUARD THAT WENT MISSING IN THE REFACTOR. One per page used to be
   * guaranteed for free, because the hero archetype was a singleton and its
   * heading was the <h1>. Fourteen archetypes became two, the singleton went
   * with them, and the replacement warning - which the plan called for - was
   * never built. By 2026-09-01 three live pages had NO page title at all
   * (Home, About Us, Contact) and the demo page had two, and nothing
   * anywhere said so.
   *
   * Counted off the LIVE sections only: a switched-off section draws
   * nothing, so its heading is not on the page.
   */
  get pageTitleCount(): number {
    let found = 0;
    for (const section of this.liveSections) {
      for (const column of section.columns ?? []) {
        for (const piece of column?.pieces ?? []) {
          if (piece?.kind === 'heading' && piece.level === 'page' && piece.isActive !== false) {
            found++;
          }
        }
      }
    }
    return found;
  }

  /** What to say about it, or null when there is nothing to say. Written as
   *  one getter so the message and the condition cannot disagree. */
  get pageTitleProblem(): string | null {
    if (this.loading || this.loadFailed || !this.sections.length) {
      return null;
    }
    const n = this.pageTitleCount;
    if (n === 0) {
      return 'Nothing on this page is set as the Page title, so search engines '
        + 'have no heading to read it by. Open a heading and set its size to '
        + '“Page title”.';
    }
    if (n > 1) {
      return `${n} headings on this page are set as the Page title. A page has `
        + 'one; the rest should be Section headings.';
    }
    return null;
  }


  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  canDelete(): boolean {
    return this.permissionService.canDelete(this.screenKey);
  }
}

/**
 * Strips markup - a heading may carry <strong>, and a row is one line.
 *
 * A line break becomes a SPACE, like the preview's own version: a heading
 * written "Your discipleship library,<br>in your pocket." otherwise summarises
 * as "library,in your pocket".
 */
function plain(html: string | undefined): string {
  return (html ?? '')
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|ul|ol|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * A key nothing else on the page uses.
 *
 * Keys are identity here rather than a contract - a page reads type and
 * order - but they still have to be unique, because the list is tracked by
 * key and a duplicate would make two rows behave as one.
 */
export function uniqueKey(type: string, existing: readonly PageContentBlock[]): string {
  const taken = new Set(existing.map((s) => s.key));
  if (!taken.has(type)) {
    return type;
  }
  let n = 2;
  while (taken.has(`${type}-${n}`)) {
    n++;
  }
  return `${type}-${n}`;
}
