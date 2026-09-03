import { Component, OnDestroy, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subject } from 'rxjs';
import { SiteNavigationService } from 'src/app/common/services/data/site-navigation.service';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { CreatedPage, SitePagesNavService } from '../pages/site-pages-nav.service';
import {
  SiteNavItem,
  liveNavItems,
  validateSiteNavigation
} from '@impact-common/shared/models/domain/site-navigation.model';
import {
  SITE_ROUTES,
  SITE_ROUTE_GROUPS,
  SiteRoute,
  siteRoutePath
} from '@impact-common/shared/lists/site_routes';

/**
 * A catalogue entry with its key still a LITERAL rather than widened to
 * `string`. SITE_ROUTES is `as const satisfies readonly SiteRoute[]` so that
 * SiteRouteKey is the union of the real keys - but handled as a plain
 * SiteRoute, `key` widens back and can no longer be assigned to a nav item's
 * routeKey. Keeping this type on the add-menu is what makes a mistyped key a
 * compile error instead of a link to nowhere.
 */
type CatalogueRoute = (typeof SITE_ROUTES)[number];

/**
 * PAGE MANAGER > SITE > NAVIGATION.
 *
 * The public site's top menu, which until 2026-08-29 was two hand-maintained
 * arrays in the web repo and a deploy to change.
 *
 * SHAPED LIKE THE PAGE STACK, deliberately (Shane's call, 2026-08-30, after
 * trying the pick-then-arrange design): an ordered stack, drag to reorder,
 * click to edit one thing FULL SCREEN. Staff who can edit About Us already
 * know how to work this, and it reuses the stack's own stylesheet rather
 * than growing a parallel look.
 *
 * TWO DEPARTURES FROM THE PAGE STACK, both because a menu is not a page:
 *
 *   - NO PREVIEW AT ALL (Shane's call, 2026-08-30). The page stack frames
 *     the real page beside the editor because a page is a wall of prose and
 *     pictures that has to be seen. A menu is a row of words, and this
 *     screen already shows every one of them with its destination - a framed
 *     copy of the site would only say the same thing smaller. It would also
 *     lie until the web app ships, since the deployed build still reads the
 *     hardcoded menu.
 *   - A dropdown's children are edited one level down, inside that
 *     dropdown's own editor. That is the known cost of this shape - you
 *     never see the whole menu at once - and it is the trade that was
 *     chosen.
 */
@Component({
    selector: 'app-site-navigation',
    templateUrl: './navigation.component.html',
    // The page stack's stylesheet FIRST, so this screen is the same object
    // as the section stacks rather than a lookalike: same rows, same grips,
    // same spacing, no copy to keep in sync. Component styles are scoped, so
    // borrowing it is safe. navigation.component.css then adds only what is
    // particular to a menu.
    styleUrls: ['../pages/page-stack.component.css', './navigation.component.css'],
    standalone: false
})
export class NavigationComponent implements OnInit, OnDestroy {
  /**
   * The menu, and it is SAVED AS YOU GO.
   *
   * Reordering, switching an item on or off, adding and removing all write
   * immediately, exactly as the twelve page section stacks have always done -
   * see PageStackComponent.persist(), which this deliberately mirrors down to
   * the snackbar wording and the reload-on-failure.
   *
   * It did not, until 2026-08-30. It held a working copy behind a SAVE
   * button, which is defensible on its own terms - a menu is a shape, and
   * publishing each drag pushes half-finished arrangements to a live site -
   * but it was the ONLY screen on the Site tab that behaved that way. Shane
   * switched a footer link off, went to look at the site, came back and found
   * it on again, and reasonably read that as the save being broken. It was
   * not: he had not pressed a button he could not see. One inconsistent
   * screen is a worse problem than a slightly eager write.
   *
   * The wording of an item is still committed explicitly, in the full-screen
   * editor - the same split Page Manager already draws between structure and
   * text.
   */
  items: SiteNavItem[] = [];

  /** The item's stored values when its editor opened, so CANCEL there has
   *  something to go back to. Only ever holds the one item being edited. */
  private editingSnapshot: string | null = null;

  loaded = false;
  loadFailed = false;
  /** The document does not exist here - a different state from an empty menu
   *  and from a failed read. */
  notSeeded = false;
  /** A write is in flight. Disables the controls rather than letting a second
   *  drag race the first. */
  saving = false;

  /** The item being edited full screen, and its parent if it is a child.
   *  Held by id, not by reference: the arrays are rebuilt on every drag and
   *  a held reference can outlive the array it came from. */
  editingId: string | null = null;

  readonly routeGroups = SITE_ROUTE_GROUPS;

  /** The home page - the header is on every page and '/' is the least to
   *  load. Site-relative; the previewer builds the URL from the
   *  environment's own publicSiteUrl. */
  readonly previewPath = '/';

  /**
   * How tall a slice of the framed page to show: the header band, nothing
   * else. MEASURED, not guessed - the real header is exactly 80px at the
   * 1440px width the previewer frames at, checked against the live site with
   * its fonts loaded, since a fallback font measures differently.
   */
  readonly headerHeight = 80;

  /** Bumped after every write so the frame reloads and shows the menu as it
   *  now stands rather than the one it was serving. */
  previewRevision = 0;

  private ngUnsubscribe = new Subject<void>();


  constructor(
    private service: SiteNavigationService,
    private snackbar: SnackbarService,
    private confirm: ConfirmService,
    private sitePages: SitePagesNavService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private load(): Promise<void> {
    return this.service.load()
      .then((items) => {
        if (items === null) {
          this.notSeeded = true;
          this.items = [];
        } else {
          this.items = JSON.parse(JSON.stringify(items));
        }
        this.loaded = true;
      })
      .catch((err) => {
        console.error('Failed to read the site navigation:', err);
        this.loadFailed = true;
        this.loaded = true;
      });
  }

  /**
   * Writes the whole ordered menu and says so. The array IS the order.
   *
   * On failure it RELOADS rather than leaving the screen showing a change
   * that never landed - the same choice PageStackComponent makes, and the
   * important half: a screen that keeps displaying a failed edit is how
   * somebody walks away believing they saved.
   */
  private async persist(message: string): Promise<void> {
    if (!this.canEdit) {
      return;
    }
    this.saving = true;
    try {
      await this.service.save(this.items);
      this.previewRevision++;
      this.snackbar.success(message);
    } catch (err) {
      console.error('Could not save the menu:', err);
      this.snackbar.error('Could not save that - reload and try again');
      await this.load();
    } finally {
      this.saving = false;
    }
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  // ---- state ----

  get canEdit(): boolean {
    return this.loaded && !this.loadFailed;
  }

  /** What a VISITOR would see - switched-off items and dropdowns left with
   *  nothing visible inside them drop out. */
  get liveCount(): number {
    return liveNavItems(this.items).length;
  }

  /** Everything wrong with the working copy, in plain sentences, shown while
   *  editing rather than only on save - an empty dropdown should be visible
   *  before somebody presses the button. */
  get problems(): string[] {
    return validateSiteNavigation(this.items);
  }

  // ---- the stack ----

  summary(item: SiteNavItem): string {
    const bits: string[] = [];
    if (item.kind === 'group') {
      const n = (item.children ?? []).length;
      bits.push(n === 1 ? '1 item inside' : `${n} items inside`);
    } else if (item.kind === 'custom') {
      bits.push(item.url || 'no address yet');
      if (item.external) bits.push('opens in a new tab');
    } else {
      bits.push((item.routeKey && siteRoutePath(item.routeKey)) || 'this page no longer exists');
    }
    if (item.highlight) bits.push('highlighted');
    return bits.join(' · ');
  }

  /** A page item whose stored route has left the catalogue. It renders as a
   *  link to nowhere and nothing else would say so. */
  isStale(item: SiteNavItem): boolean {
    return item.kind === 'page' && !!item.routeKey && !siteRoutePath(item.routeKey);
  }

  iconFor(item: SiteNavItem): string {
    if (item.kind === 'group') return 'expand_more';
    if (item.kind === 'custom') return item.external ? 'open_in_new' : 'link';
    return 'description';
  }

  async reorder(event: CdkDragDrop<SiteNavItem[]>): Promise<void> {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    moveItemInArray(this.items, event.previousIndex, event.currentIndex);
    this.items = [...this.items];
    await this.persist('Order saved');
  }

  async toggleLive(item: SiteNavItem): Promise<void> {
    item.visible = !item.visible;
    await this.persist(item.visible ? 'Showing in the menu' : 'Taken out of the menu');
  }

  /**
   * Removes an item, ASKING FIRST.
   *
   * It did not ask until 2026-09-01: one click on the bin took a link out of
   * the public site's menu and wrote that immediately. Deleting a PAGE gets
   * a full warning naming what goes with it; this is a smaller loss but the
   * same kind, and a mis-click here quietly changes what visitors can find.
   *
   * A dropdown says how many links go with it - that is the part somebody
   * would not otherwise realise they were agreeing to.
   */
  async remove(item: SiteNavItem): Promise<void> {
    const children = (item.children ?? []).length;
    const alsoGoes = children
      ? ` The ${children === 1 ? 'link' : `${children} links`} inside will go with it.`
      : '';
    const ok = await this.confirm.confirm(
      `“${item.title}” will be taken out of the site's menu.${alsoGoes}`,
      'Remove this from the menu?'
    );
    if (!ok) {
      return;
    }

    this.items = this.items
      .filter((entry) => entry.id !== item.id)
      .map((entry) => entry.children
        ? { ...entry, children: entry.children.filter((child) => child.id !== item.id) }
        : entry);
    if (this.editingId === item.id) {
      this.editingId = null;
    }
    await this.persist(`“${item.title}” removed`);
  }

  // ---- adding ----

  routesIn(group: SiteRoute['group']): CatalogueRoute[] {
    return SITE_ROUTES.filter((route) => route.group === group);
  }

  // ---- pages staff created ----

  /**
   * THE PAGES THIS ADMIN MADE, offered in the Add menu beside the built-in
   * routes.
   *
   * They were not offered at all until 2026-09-01, and could not be: the
   * picker's only source is SITE_ROUTES, a hand-written list in the shared
   * submodule that a staff-created page cannot get into without a code
   * change and three deploys. So the whole point of the page builder - make
   * a page without a developer - stopped one step short of anyone finding
   * the page.
   *
   * STORED AS AN ADDRESS, not a routeKey, and that is deliberate. A `page`
   * item resolves its key through SITE_ROUTES, and a key that is not in
   * there resolves to '' - a dead menu item. The usual objection to storing
   * a URL is that routes move; a created page's slug is its document id and
   * the New Page dialog refuses to change it after creation, so this one
   * cannot move. The picker still does the typing, which is what kept
   * hand-typed addresses out.
   */
  get createdPages(): CreatedPage[] {
    return this.sitePages.pages;
  }

  /** Where a created page lives. One definition, used to add and to
   *  recognise, so the two cannot drift apart. */
  private pathOf(page: CreatedPage): string {
    return '/' + page.slug;
  }

  /** Already in the menu, at either level - the same greying-out the
   *  built-in routes get. */
  isPageInMenu(page: CreatedPage): boolean {
    const path = this.pathOf(page);
    for (const item of this.items) {
      if (item.url === path) return true;
      for (const child of item.children ?? []) {
        if (child.url === path) return true;
      }
    }
    return false;
  }

  private createdPageItem(page: CreatedPage): SiteNavItem {
    return {
      id: this.newId(page.slug),
      title: page.title,
      kind: 'custom',
      url: this.pathOf(page),
      // On this site, so it moves through the app rather than reloading it.
      external: false,
      visible: true
    } as SiteNavItem;
  }

  async addCreatedPage(page: CreatedPage): Promise<void> {
    this.items = [...this.items, this.createdPageItem(page)];
    await this.persist(`“${page.title}” added`);
  }

  async addCreatedPageToGroup(page: CreatedPage, parent: SiteNavItem): Promise<void> {
    const children = parent.children ?? (parent.children = []);
    children.push(this.createdPageItem(page));
    this.items = [...this.items];
    await this.persist(`“${page.title}” added`);
  }

  /** Already in the menu at either level - the add menu greys these out
   *  rather than letting the same page in twice. */
  isInMenu(route: CatalogueRoute): boolean {
    for (const item of this.items) {
      if (item.routeKey === route.key) return true;
      for (const child of item.children ?? []) {
        if (child.routeKey === route.key) return true;
      }
    }
    return false;
  }

  async addPage(route: CatalogueRoute): Promise<void> {
    this.items = [...this.items, {
      id: this.newId(route.key),
      title: route.label,
      kind: 'page',
      routeKey: route.key,
      visible: true
    }];
    await this.persist(`“${route.label}” added`);
  }

  addLink(): void {
    const item: SiteNavItem = {
      id: this.newId('link'), title: 'New link', kind: 'custom',
      url: '', external: false, visible: true
    };
    this.items = [...this.items, item];
    // Straight into the editor - it has no address yet. NOT persisted first:
    // a link with no address fails the validator, so it is written when the
    // editor is saved, once it has one.
    this.edit(item);
  }

  addDropdown(): void {
    const item: SiteNavItem = {
      id: this.newId('menu'), title: 'New dropdown', kind: 'group',
      visible: true, children: []
    };
    this.items = [...this.items, item];
    // Same reason as a new link: an empty dropdown fails the validator, so
    // it is written once it has something in it.
    this.edit(item);
  }

  // ---- editing one item, full screen ----

  get editing(): SiteNavItem | null {
    if (!this.editingId) return null;
    for (const item of this.items) {
      if (item.id === this.editingId) return item;
      for (const child of item.children ?? []) {
        if (child.id === this.editingId) return child;
      }
    }
    return null; // removed while open
  }

  /** The dropdown the item being edited belongs to, if any - so the editor
   *  can say where you are and get you back there. */
  get editingParent(): SiteNavItem | null {
    if (!this.editingId) return null;
    for (const item of this.items) {
      for (const child of item.children ?? []) {
        if (child.id === this.editingId) return item;
      }
    }
    return null;
  }

  edit(item: SiteNavItem): void {
    this.editingId = item.id;
    this.editingSnapshot = JSON.stringify(item);
  }

  // ---- where a link goes, and whether that is off this site ----

  /**
   * Ids whose "opens in a new tab" the person has set for themselves.
   *
   * Session-only, and deliberately not stored: it exists so the address
   * field stops overruling a deliberate choice while that choice is being
   * made. Once the editor closes there is nothing left to arbitrate.
   */
  private readonly externalChosen = new Set<string>();

  /**
   * Whether an address leaves this site. A scheme or a protocol-relative
   * `//host` does; anything starting `/` is a page here.
   */
  private isOffSite(url: string): boolean {
    return /^([a-z][a-z0-9+.-]*:)?\/\//i.test((url ?? '').trim());
  }

  /**
   * THE ADDRESS DECIDES, until somebody decides for themselves.
   *
   * Every custom link was created `external: true`, so a link to a page on
   * this site rendered `<a target="_blank">` and the top menu opened a
   * second browser tab instead of moving through the site (2026-09-01).
   * Creation now defaults it off, and typing an address off-site turns it
   * back on - which is the answer that is right without anybody thinking
   * about it.
   */
  onUrlChange(item: SiteNavItem, url: string): void {
    item.url = url;
    if (!this.externalChosen.has(item.id)) {
      item.external = this.isOffSite(url);
    }
  }

  onExternalChange(item: SiteNavItem, value: boolean): void {
    this.externalChosen.add(item.id);
    item.external = value;
  }

  /**
   * DONE. Commits what is open, THEN closes it.
   *
   * IT USED TO BE `closeEditor()` ALONE, and that lost work silently. A new
   * link added, named, given an address and DONE'd was never written: the
   * close cleared `editingSnapshot`, so `hasUnsavedChanges()` went false and
   * the route guard stopped defending the wording as well. The list went on
   * showing the item until the next reload, so the screen read "9 of 9
   * showing on the site" about something the site had never been told about
   * (found 2026-09-01; the database still had 8).
   *
   * A failed save keeps the editor OPEN - a link with no address cannot be
   * stored, and closing over the top of that is how it went missing before.
   * The snackbar has already said what is wrong.
   */
  async onDoneClicked(): Promise<void> {
    if (this.hasUnsavedChanges()) {
      try {
        await this.save();
      } catch {
        return;
      }
    }
    this.closeEditor();
  }

  closeEditor(): void {
    // Back to the dropdown you came from rather than all the way out, when
    // there is one - editing three children in a row should not mean three
    // trips through the stack.
    const parent = this.editingParent;
    this.editingId = parent?.id ?? null;
    this.editingSnapshot = parent ? JSON.stringify(parent) : null;
  }

  // ---- a dropdown's children, one level down ----

  childrenOf(item: SiteNavItem): SiteNavItem[] {
    return item.children ?? [];
  }

  async reorderChildren(event: CdkDragDrop<SiteNavItem[]>, parent: SiteNavItem): Promise<void> {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    const children = parent.children ?? (parent.children = []);
    moveItemInArray(children, event.previousIndex, event.currentIndex);
    this.items = [...this.items];
    await this.persist('Order saved');
  }

  async addPageToGroup(route: CatalogueRoute, parent: SiteNavItem): Promise<void> {
    const children = parent.children ?? (parent.children = []);
    children.push({
      id: this.newId(route.key), title: route.label,
      kind: 'page', routeKey: route.key, visible: true
    });
    this.items = [...this.items];
    await this.persist(`“${route.label}” added`);
  }

  addLinkToGroup(parent: SiteNavItem): void {
    const children = parent.children ?? (parent.children = []);
    const child: SiteNavItem = {
      id: this.newId('link'), title: 'New link', kind: 'custom',
      url: '', external: false, visible: true
    };
    children.push(child);
    this.items = [...this.items];
    // Not persisted yet - a link with no address fails the validator. It is
    // written when its editor is saved, once it has one.
    this.edit(child);
  }

  /** Lifts a child out to the top level, which is the only way back up -
   *  there is no cross-list dragging in this shape, because you cannot see
   *  both lists at once. */
  async liftOut(child: SiteNavItem, parent: SiteNavItem): Promise<void> {
    parent.children = (parent.children ?? []).filter((entry) => entry.id !== child.id);
    this.items = [...this.items, child];
    await this.persist(`“${child.title}” moved out`);
  }

  // ---- editing one item, and committing its wording ----

  /**
   * Whether the item open in the editor has wording that has not been
   * written yet. Structure saves itself; TEXT does not, which is the same
   * split Page Manager draws - so this is the only unsaved state left, and
   * the only thing the leave-guard has to defend.
   */
  hasUnsavedChanges(): boolean {
    return !!this.editing && this.editingSnapshot !== null
      && JSON.stringify(this.editing) !== this.editingSnapshot;
  }

  /** Commits the open item. Rejects on failure so the leave-guard keeps
   *  somebody here rather than navigating away with their wording gone. */
  async save(): Promise<void> {
    if (!this.hasUnsavedChanges()) {
      return;
    }
    const problems = this.problems;
    if (problems.length) {
      this.snackbar.error(problems[0]);
      throw new Error(problems.join('; '));
    }
    this.saving = true;
    try {
      await this.service.save(this.items);
      this.previewRevision++;
      this.editingSnapshot = JSON.stringify(this.editing);
      this.snackbar.success('Saved');
    } catch (err) {
      console.error('Could not save the menu:', err);
      this.snackbar.error('Could not save that - reload and try again');
      throw err;
    } finally {
      this.saving = false;
    }
  }

  /** The SAVE button. Swallows the rejection - the snackbar has already
   *  said what went wrong. */
  onSaveClicked(): void {
    this.save().catch(() => undefined);
  }

  /** Puts the open item back to what was stored when it was opened. */
  revert(): void {
    if (!this.editing || this.editingSnapshot === null) {
      return;
    }
    // Mutated in place rather than replaced: `editing` is a live reference
    // into `items`, and swapping the object would leave the array pointing at
    // the old one. Keys are cleared first so a field the edit ADDED (a url on
    // what was a page item) does not survive the revert.
    const stored = JSON.parse(this.editingSnapshot) as SiteNavItem;
    const target = this.editing as unknown as Record<string, unknown>;
    Object.keys(target).forEach((k) => delete target[k]);
    Object.assign(target, stored);
    this.items = [...this.items];
  }

  /** Readable and unique enough for a document nobody hand-edits. Not a
   *  UUID: these ids appear in JSON a developer may have to read. */
  private newId(hint: string): string {
    const base = 'nav-' + String(hint).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const taken = new Set<string>();
    for (const item of this.items) {
      taken.add(item.id);
      for (const child of item.children ?? []) taken.add(child.id);
    }
    let id = base;
    let n = 2;
    while (taken.has(id)) {
      id = `${base}-${n++}`;
    }
    return id;
  }
}
