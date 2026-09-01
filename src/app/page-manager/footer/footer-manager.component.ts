import { Component, ViewChild } from '@angular/core';
import { TabShellComponent } from '../../core/main-screen/tab-shell.component';
import { SiteFooterAdminComponent } from './footer.component';

/**
 * THE BOTTOM OF EVERY PAGE - the footer, and the strip that floats over it.
 *
 * FOOTER was a flat link until 2026-09-01: clicking it opened the footer
 * editor and there was nothing under it. It became a group when the DOCKING
 * BAR moved here (owner's call), which needed somewhere to live that was not
 * two tabs deep in a settings form.
 *
 * The two belong together and are not the same thing. The footer is part of
 * the page and scrolls with it; the dock is fixed to the bottom of the
 * WINDOW, sits over whatever is behind it, can be dismissed by the visitor,
 * and hides itself on checkout. What they share is that both are the bottom
 * of the screen on every page of the site, which is what somebody arriving
 * here is looking for.
 *
 * A TAB SHELL like every other group, which brings the two behaviours that
 * matter and were each fixed once across nine copies: selectedTab starts
 * EMPTY, so a direct URL cannot render a screen to somebody with no grant;
 * and permissions and ?tab= are read as a live stream rather than once, so a
 * later permission emission re-filters. See tab-shell.component.ts.
 */
@Component({
  selector: 'app-footer-manager',
  templateUrl: './footer-manager.component.html',
  standalone: false
})
export class FooterManagerComponent extends TabShellComponent {
  protected readonly groupId = 'footer';

  /**
   * THE UNSAVED-CHANGES GUARD RUNS ON THIS COMPONENT, because this is
   * what the route resolves to now - so it has to answer for the screen
   * inside it.
   *
   * The guard was written against SiteFooterAdminComponent and calls
   * hasUnsavedChanges() on whatever the route holds. The moment the shell
   * took over the route, that call landed on a component that had no such
   * method - which throws inside a canDeactivate guard, and a guard that
   * throws blocks the navigation.
   *
   * The protection it exists for is real and was asked for: the footer
   * holds a local working copy and publishes on SAVE, so leaving without
   * saving loses the work silently. Delegating keeps it.
   */
  @ViewChild(SiteFooterAdminComponent) private footer?: SiteFooterAdminComponent;

  hasUnsavedChanges(): boolean {
    // Only the footer tab has unsaved state to lose. On the docking bar
    // the footer editor is not even rendered, and nothing to ask about
    // must read as "nothing to lose" rather than as an error.
    return this.footer?.hasUnsavedChanges() ?? false;
  }

  async save(): Promise<void> {
    await this.footer?.save();
  }
}
