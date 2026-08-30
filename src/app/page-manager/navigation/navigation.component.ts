import { Component, OnDestroy, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { Subject } from 'rxjs';
import { SiteNavigationService } from 'src/app/common/services/data/site-navigation.service';
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
  /** The working copy. Every edit is local until Save - a menu is a shape,
   *  and saving each drag would publish half-finished arrangements to a live
   *  site. */
  items: SiteNavItem[] = [];

  /** What was last read, so Cancel has something to go back to and `dirty`
   *  has something to compare against. */
  private saved = '';

  loaded = false;
  loadFailed = false;
  /** The document does not exist here - a different state from an empty menu
   *  and from a failed read. */
  notSeeded = false;
  saving = false;
  error: string | null = null;
  justSaved = false;

  /** The item being edited full screen, and its parent if it is a child.
   *  Held by id, not by reference: the arrays are rebuilt on every drag and
   *  a held reference can outlive the array it came from. */
  editingId: string | null = null;

  readonly routeGroups = SITE_ROUTE_GROUPS;

  private ngUnsubscribe = new Subject<void>();

  constructor(private service: SiteNavigationService) {}

  ngOnInit(): void {
    this.service.load()
      .then((items) => {
        if (items === null) {
          this.notSeeded = true;
          this.items = [];
        } else {
          this.items = JSON.parse(JSON.stringify(items));
        }
        this.saved = JSON.stringify(this.items);
        this.loaded = true;
      })
      .catch((err) => {
        console.error('Failed to read the site navigation:', err);
        this.loadFailed = true;
        this.loaded = true;
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  // ---- state ----

  get dirty(): boolean {
    return this.loaded && JSON.stringify(this.items) !== this.saved;
  }

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

  reorder(event: CdkDragDrop<SiteNavItem[]>): void {
    moveItemInArray(this.items, event.previousIndex, event.currentIndex);
    this.items = [...this.items];
    this.touched();
  }

  toggleLive(item: SiteNavItem): void {
    item.visible = !item.visible;
    this.touched();
  }

  remove(item: SiteNavItem): void {
    this.items = this.items
      .filter((entry) => entry.id !== item.id)
      .map((entry) => entry.children
        ? { ...entry, children: entry.children.filter((child) => child.id !== item.id) }
        : entry);
    if (this.editingId === item.id) {
      this.editingId = null;
    }
    this.touched();
  }

  // ---- adding ----

  routesIn(group: SiteRoute['group']): CatalogueRoute[] {
    return SITE_ROUTES.filter((route) => route.group === group);
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

  addPage(route: CatalogueRoute): void {
    this.items = [...this.items, {
      id: this.newId(route.key),
      title: route.label,
      kind: 'page',
      routeKey: route.key,
      visible: true
    }];
    this.touched();
  }

  addLink(): void {
    const item: SiteNavItem = {
      id: this.newId('link'), title: 'New link', kind: 'custom',
      url: '', external: true, visible: true
    };
    this.items = [...this.items, item];
    this.touched();
    // Straight into the editor - it has no address yet, and a link with no
    // address is a dead entry the validator would later block the save over
    // without saying which item it meant.
    this.edit(item);
  }

  addDropdown(): void {
    const item: SiteNavItem = {
      id: this.newId('menu'), title: 'New dropdown', kind: 'group',
      visible: true, children: []
    };
    this.items = [...this.items, item];
    this.touched();
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
  }

  closeEditor(): void {
    // Back to the dropdown you came from rather than all the way out, when
    // there is one - editing three children in a row should not mean three
    // trips through the stack.
    this.editingId = this.editingParent?.id ?? null;
  }

  // ---- a dropdown's children, one level down ----

  childrenOf(item: SiteNavItem): SiteNavItem[] {
    return item.children ?? [];
  }

  reorderChildren(event: CdkDragDrop<SiteNavItem[]>, parent: SiteNavItem): void {
    const children = parent.children ?? (parent.children = []);
    moveItemInArray(children, event.previousIndex, event.currentIndex);
    this.items = [...this.items];
    this.touched();
  }

  addPageToGroup(route: CatalogueRoute, parent: SiteNavItem): void {
    const children = parent.children ?? (parent.children = []);
    children.push({
      id: this.newId(route.key), title: route.label,
      kind: 'page', routeKey: route.key, visible: true
    });
    this.items = [...this.items];
    this.touched();
  }

  addLinkToGroup(parent: SiteNavItem): void {
    const children = parent.children ?? (parent.children = []);
    const child: SiteNavItem = {
      id: this.newId('link'), title: 'New link', kind: 'custom',
      url: '', external: true, visible: true
    };
    children.push(child);
    this.items = [...this.items];
    this.touched();
    this.edit(child);
  }

  /** Lifts a child out to the top level, which is the only way back up -
   *  there is no cross-list dragging in this shape, because you cannot see
   *  both lists at once. */
  liftOut(child: SiteNavItem, parent: SiteNavItem): void {
    parent.children = (parent.children ?? []).filter((entry) => entry.id !== child.id);
    this.items = [...this.items, child];
    this.touched();
  }

  // ---- saving ----

  touched(): void {
    this.justSaved = false;
    this.error = null;
  }

  /** What the leave-guard asks. See site-frame.guard.ts - edits here are
   *  deliberately not auto-saved, so the exit has to be defended. */
  hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  /**
   * Saves, and REJECTS on failure.
   *
   * The guard needs a promise it can await and catch: on a rejection it keeps
   * the person on this page rather than navigating away with their changes
   * silently gone. The button path swallows the rejection itself, because a
   * click has already been told about it by `error`.
   */
  save(): Promise<void> {
    if (this.saving || !this.dirty) {
      return Promise.resolve();
    }
    if (this.problems.length) {
      return Promise.reject(new Error(this.problems.join('\n')));
    }
    this.saving = true;
    this.error = null;

    return this.service.save(this.items)
      .then(() => {
        this.saved = JSON.stringify(this.items);
        this.saving = false;
        this.justSaved = true;
      })
      .catch((err) => {
        console.error('Failed to save the site navigation:', err);
        this.saving = false;
        this.error = err?.message || 'Could not save the menu. Please try again.';
        throw err;
      });
  }

  /** The SAVE button. Separate from save() so the template does not create an
   *  unhandled rejection - the error is already on screen. */
  onSaveClicked(): void {
    this.save().catch(() => undefined);
  }

  revert(): void {
    this.items = JSON.parse(this.saved || '[]');
    this.editingId = null;
    this.touched();
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
