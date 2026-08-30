import { Component, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { NavLeaf } from '../core/main-screen/nav-config';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';
import { EDITABLE_PAGES, EditablePage } from './pages/page-section-catalogue';
import { SitePagesNavService } from './pages/site-pages-nav.service';

@Component({
    selector: 'app-page-manager',
    templateUrl: './page-manager.component.html',
    styleUrls: ['./page-manager.component.css'],
    standalone: false
})
export class PageManagerComponent extends TabShellComponent {
  protected readonly groupId = 'page-manager';

  // inject(), not a constructor parameter: the base takes its deps through
  // its own constructor and this class declares none - adding one would mean
  // re-declaring all of the base's to call super. New code, house style.
  private readonly sitePagesNav = inject(SitePagesNavService);

  /**
   * Every public page, each an ordered stack of sections on one screen.
   *
   * Their nav leaves live in nav-config.ts like every other screen; this is
   * what maps the selected tab onto the right catalogue entry. About Us used
   * to have its own block here, because it was the only page whose template
   * was a dispatcher - all eleven are now, so it does not.
   */
  readonly editablePages: readonly EditablePage[] = EDITABLE_PAGES;

  /** Labels the static tab blocks already claim. A created page whose title
   *  collides is reached through the Pages list instead of a leaf - the
   *  static screens are what the permission registry knows. */
  private readonly staticLabels = new Set<string>([
    ...this.items.map((item) => item.label)
  ]);

  /** The created pages, as live extra tabs - what makes a deep link to
   *  ?tab=<created-slug> resolve once the Firestore read lands. */
  protected override extraItems$(): Observable<NavLeaf[]> {
    return this.sitePagesNav.leaves$;
  }

  /**
   * The created page the selected tab names, or null when the tab is one of
   * the static screens. Drives the ONE extra block in the template; the
   * static blocks all match on label first, so this also refusing static
   * labels means no tab can ever render twice.
   */
  get dynamicPageSlug(): string | null {
    if (!this.selectedTab || this.staticLabels.has(this.selectedTab)) {
      return null;
    }
    return this.sitePagesNav.leaves
      .find((leaf) => leaf.label === this.selectedTab)?.slug ?? null;
  }
}
