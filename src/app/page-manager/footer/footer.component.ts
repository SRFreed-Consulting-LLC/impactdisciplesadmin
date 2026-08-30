import { Component, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { SiteFooterService } from 'src/app/common/services/data/site-footer.service';
import { WebConfigService } from 'src/app/common/services/data/web-config.service';
import { WebConfigModel } from '@impact-common/shared/models/utils/web-config.model';
import {
  SiteFooter,
  SiteFooterColumn,
  liveFooterColumns,
  validateSiteFooter
} from '@impact-common/shared/models/domain/site-footer.model';
import { SiteNavItem } from '@impact-common/shared/models/domain/site-navigation.model';
import {
  SITE_ROUTES,
  SITE_ROUTE_GROUPS,
  SiteRoute,
  siteRoutePath
} from '@impact-common/shared/lists/site_routes';

/** A catalogue entry with its key still a literal - see the same type in
 *  navigation.component.ts for why plain SiteRoute will not do. */
type CatalogueRoute = (typeof SITE_ROUTES)[number];

/**
 * PAGE MANAGER > SITE > FOOTER.
 *
 * The footer is on every page and every word of it was hardcoded - fourteen
 * links, four headings and three lines of copyright, each a deploy to change.
 *
 * ONE SECTION, THREE CARDS, EACH ANSWERING A QUESTION (Shane's call,
 * 2026-08-30). The rendered footer has five columns and a bottom bar, which
 * is a layout rather than a way to think about it; these three are:
 *
 *   WHO WE ARE     the masthead, the two links under it, the rights line,
 *                  and the address/phone/email
 *   WHERE THEY GO  the link columns - the actual navigation in the footer
 *   KEEP IN TOUCH  the newsletter wording, the bottom bar, and the socials
 *
 * THE CONTACT DETAILS AND SOCIAL LINKS ARE READ-ONLY HERE. They live on
 * web_config and are edited on the Web Config screen. The footer used to
 * render a SECOND, hardcoded copy of them that nobody could edit - so this
 * screen shows what the site will actually use and points at where to change
 * it, rather than becoming a third copy.
 */
@Component({
    selector: 'app-site-footer',
    templateUrl: './footer.component.html',
    styleUrls: ['./footer.component.css'],
    standalone: false
})
export class SiteFooterAdminComponent implements OnInit {
  footer: SiteFooter | null = null;

  /** What was last read, so Cancel has something to go back to. */
  private saved = '';

  /** Read-only, from web_config - the details the site will actually use. */
  config: WebConfigModel | null = null;

  loaded = false;
  loadFailed = false;
  notSeeded = false;
  saving = false;
  error: string | null = null;
  justSaved = false;

  readonly routeGroups = SITE_ROUTE_GROUPS;

  constructor(
    private service: SiteFooterService,
    private webConfig: WebConfigService
  ) {}

  ngOnInit(): void {
    this.service.load()
      .then((footer) => {
        if (footer === null) {
          this.notSeeded = true;
          this.footer = null;
        } else {
          this.footer = JSON.parse(JSON.stringify(footer));
        }
        this.saved = JSON.stringify(this.footer);
        this.loaded = true;
      })
      .catch((err) => {
        console.error('Failed to read the site footer:', err);
        this.loadFailed = true;
        this.loaded = true;
      });

    this.webConfig.getAll()
      .then((configs) => this.config = configs?.[0] ?? null)
      .catch((err) => console.error('Failed to read web config for the footer:', err));
  }

  // ---- state ----

  get dirty(): boolean {
    return this.loaded && JSON.stringify(this.footer) !== this.saved;
  }

  get canEdit(): boolean {
    return this.loaded && !this.loadFailed && !!this.footer;
  }

  get problems(): string[] {
    return this.footer ? validateSiteFooter(this.footer) : [];
  }

  /** Columns a visitor would actually see - a switched-off column, or one
   *  left with no visible links, is dropped by the site. */
  get liveColumnCount(): number {
    return this.footer ? liveFooterColumns(this.footer.columns ?? []).length : 0;
  }

  /** The address as the site renders it - one line, from the structured
   *  fields on web_config. */
  get addressLine(): string {
    const address = this.config?.address;
    if (!address) {
      return '';
    }
    return [address.address1, address.address2, address.city, address.state, address.zip]
      .filter((part) => !!part && String(part).trim()).join(', ');
  }

  /** The socials that will actually render, in the order the footer draws
   *  them. Anything blank on web_config simply does not appear - which is
   *  why LinkedIn and Instagram were invisible before: the hardcoded copy
   *  the footer used to read had no such fields at all. */
  get socialLinks(): { label: string; url: string }[] {
    const c = this.config;
    if (!c) {
      return [];
    }
    return [
      { label: 'Facebook', url: c.facebook ?? '' },
      { label: 'X / Twitter', url: c.twitter ?? '' },
      { label: 'YouTube', url: c.youtube ?? '' },
      { label: 'LinkedIn', url: c.linkedIn ?? '' },
      { label: 'Instagram', url: c.instagram ?? '' }
    ].filter((entry) => !!entry.url?.trim());
  }

  touched(): void {
    this.justSaved = false;
    this.error = null;
  }

  // ---- links and columns ----

  routesIn(group: SiteRoute['group']): CatalogueRoute[] {
    return SITE_ROUTES.filter((route) => route.group === group);
  }

  destination(link: SiteNavItem): string {
    if (link.kind === 'custom') {
      return link.url || '(no address yet)';
    }
    return (link.routeKey && siteRoutePath(link.routeKey)) || '(this page no longer exists)';
  }

  isStale(link: SiteNavItem): boolean {
    return link.kind === 'page' && !!link.routeKey && !siteRoutePath(link.routeKey);
  }

  reorderColumns(event: CdkDragDrop<SiteFooterColumn[]>): void {
    if (!this.footer) return;
    moveItemInArray(this.footer.columns, event.previousIndex, event.currentIndex);
    this.touched();
  }

  reorderLinks(event: CdkDragDrop<SiteNavItem[]>, column: SiteFooterColumn): void {
    moveItemInArray(column.links, event.previousIndex, event.currentIndex);
    this.touched();
  }

  addColumn(): void {
    if (!this.footer) return;
    this.footer.columns.push({
      id: this.newId('column'), heading: 'New column', links: [], visible: true
    });
    this.touched();
  }

  removeColumn(column: SiteFooterColumn): void {
    if (!this.footer) return;
    this.footer.columns = this.footer.columns.filter((entry) => entry.id !== column.id);
    this.touched();
  }

  addPage(route: CatalogueRoute, links: SiteNavItem[]): void {
    links.push({
      id: this.newId(route.key), title: route.label,
      kind: 'page', routeKey: route.key, visible: true
    });
    this.touched();
  }

  addLink(links: SiteNavItem[]): void {
    links.push({
      id: this.newId('link'), title: 'New link', kind: 'custom',
      url: '', external: true, visible: true
    });
    this.touched();
  }

  removeLink(link: SiteNavItem, links: SiteNavItem[]): void {
    const at = links.findIndex((entry) => entry.id === link.id);
    if (at >= 0) {
      links.splice(at, 1);
      this.touched();
    }
  }

  // ---- saving ----

  /** What the leave-guard asks. See site-frame.guard.ts - edits here are
   *  deliberately not auto-saved, so the exit has to be defended. */
  hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  /** Saves, and REJECTS on failure, so the guard can keep somebody on this
   *  page rather than navigating away with their changes silently gone. */
  save(): Promise<void> {
    if (!this.footer || this.saving || !this.dirty) {
      return Promise.resolve();
    }
    if (this.problems.length) {
      return Promise.reject(new Error(this.problems.join('\n')));
    }
    this.saving = true;
    this.error = null;

    return this.service.save(this.footer)
      .then(() => {
        this.saved = JSON.stringify(this.footer);
        this.saving = false;
        this.justSaved = true;
      })
      .catch((err) => {
        console.error('Failed to save the site footer:', err);
        this.saving = false;
        this.error = err?.message || 'Could not save the footer. Please try again.';
        throw err;
      });
  }

  /** The SAVE button. Separate from save() so the template does not create an
   *  unhandled rejection - the error is already on screen. */
  onSaveClicked(): void {
    this.save().catch(() => undefined);
  }

  revert(): void {
    this.footer = this.saved ? JSON.parse(this.saved) : null;
    this.touched();
  }

  /** Readable and unique across the whole footer - link ids and column ids
   *  share one space, because validateSiteFooter checks them together. */
  private newId(hint: string): string {
    const base = 'foot-' + String(hint).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const taken = new Set<string>();
    for (const link of this.footer?.brandLinks ?? []) taken.add(link.id);
    for (const column of this.footer?.columns ?? []) {
      taken.add(column.id);
      for (const link of column.links ?? []) taken.add(link.id);
    }
    let id = base;
    let n = 2;
    while (taken.has(id)) {
      id = `${base}-${n++}`;
    }
    return id;
  }
}
