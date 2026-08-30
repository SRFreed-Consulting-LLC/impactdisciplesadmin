import { Component, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { SiteFooterService } from 'src/app/common/services/data/site-footer.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
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
    // The page stack's stylesheet first, for the preview rail and its
    // device toggle - the same rail every page stack has, so it is borrowed
    // rather than copied. footer.component.css then adds only what is
    // particular to a footer.
    styleUrls: ['../pages/page-stack.component.css', './footer.component.css'],
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

  readonly routeGroups = SITE_ROUTE_GROUPS;

  /** The home page. The footer is on every page, so any of them would do -
   *  '/' is simply the least to load. Site-relative; the previewer builds
   *  the URL from the environment's own publicSiteUrl. */
  readonly previewPath = '/';

  /** Desktop or phone, the same choice the page stacks offer. */
  device: 'desktop' | 'mobile' = 'desktop';

  /** Bumped after every write so the frame reloads and shows the footer as
   *  it now stands rather than the one it was serving. */
  previewRevision = 0;


  constructor(
    private service: SiteFooterService,
    private webConfig: WebConfigService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.load();

    this.webConfig.getAll()
      .then((configs) => this.config = configs?.[0] ?? null)
      .catch((err) => console.error('Failed to read web config for the footer:', err));
  }

  private load(): Promise<void> {
    return this.service.load()
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
  }

  /**
   * Writes the whole footer and says so, mirroring PageStackComponent down to
   * the wording and the reload-on-failure - a screen that keeps displaying a
   * change that never landed is how somebody walks away believing they saved.
   */
  private async persist(message: string): Promise<void> {
    if (!this.footer || !this.canEdit) {
      return;
    }
    const problems = this.problems;
    if (problems.length) {
      // Structure that cannot be saved yet - an empty column, a link with no
      // address. Said plainly and left on screen to be finished, rather than
      // written in a state the site cannot render.
      this.snackbar.error(problems[0]);
      return;
    }
    this.saving = true;
    try {
      await this.service.save(this.footer);
      this.saved = JSON.stringify(this.footer);
      this.previewRevision++;
      this.snackbar.success(message);
    } catch (err) {
      console.error('Could not save the footer:', err);
      this.snackbar.error('Could not save that - reload and try again');
      await this.load();
    } finally {
      this.saving = false;
    }
  }

  /**
   * Commits a text field when it loses focus.
   *
   * The footer's wording sits inline on the cards rather than inside an
   * editor, so there is no SAVE to press and no natural moment to commit
   * except leaving the field. Saving on every keystroke would be a write per
   * character; saving on blur is the same "as you go" promise the rest of
   * the screen makes.
   */
  async commitText(): Promise<void> {
    if (this.hasUnsavedChanges()) {
      await this.persist('Saved');
    }
  }

  // ---- state ----

  /** Only ever true for a text field somebody is still inside, or structure
   *  that is not yet valid to write. Everything else saves itself. */
  hasUnsavedChanges(): boolean {
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

  async reorderColumns(event: CdkDragDrop<SiteFooterColumn[]>): Promise<void> {
    if (!this.footer || event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.footer.columns, event.previousIndex, event.currentIndex);
    await this.persist('Order saved');
  }

  async reorderLinks(event: CdkDragDrop<SiteNavItem[]>, column: SiteFooterColumn): Promise<void> {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(column.links, event.previousIndex, event.currentIndex);
    await this.persist('Order saved');
  }

  addColumn(): void {
    if (!this.footer) return;
    this.footer.columns.push({
      id: this.newId('column'), heading: 'New column', links: [], visible: true
    });
    // Not written yet: a column with no links fails the validator, so it
    // is saved once something is put in it.
  }

  async removeColumn(column: SiteFooterColumn): Promise<void> {
    if (!this.footer) return;
    this.footer.columns = this.footer.columns.filter((entry) => entry.id !== column.id);
    await this.persist(`“${column.heading}” removed`);
  }

  async addPage(route: CatalogueRoute, links: SiteNavItem[]): Promise<void> {
    links.push({
      id: this.newId(route.key), title: route.label,
      kind: 'page', routeKey: route.key, visible: true
    });
    await this.persist(`“${route.label}” added`);
  }

  addLink(links: SiteNavItem[]): void {
    links.push({
      id: this.newId('link'), title: 'New link', kind: 'custom',
      url: '', external: true, visible: true
    });
    // Not written yet - a link with no address fails the validator. Give it
    // one and it saves on blur, like every other field here.
  }

  async removeLink(link: SiteNavItem, links: SiteNavItem[]): Promise<void> {
    const at = links.findIndex((entry) => entry.id === link.id);
    if (at >= 0) {
      links.splice(at, 1);
      await this.persist(`“${link.title}” removed`);
    }
  }

  // ---- saving ----

  /** What the leave-guard calls if you choose Save on the way out. Rejects
   *  on failure so it keeps you here rather than leaving with the change
   *  gone. */
  async save(): Promise<void> {
    if (!this.hasUnsavedChanges()) {
      return;
    }
    const problems = this.problems;
    if (problems.length) {
      this.snackbar.error(problems[0]);
      throw new Error(problems.join('; '));
    }
    if (!this.footer) {
      return;
    }
    this.saving = true;
    try {
      await this.service.save(this.footer);
      this.saved = JSON.stringify(this.footer);
      this.previewRevision++;
      this.snackbar.success('Saved');
    } catch (err) {
      console.error('Could not save the footer:', err);
      this.snackbar.error('Could not save that - reload and try again');
      throw err;
    } finally {
      this.saving = false;
    }
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
