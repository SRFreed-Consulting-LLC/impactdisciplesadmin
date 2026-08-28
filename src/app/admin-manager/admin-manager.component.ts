import { Component } from '@angular/core';
import { Role } from '@impact-common/shared/lists/roles.enum';
import { NavLeaf } from 'src/app/core/main-screen/nav-config';
import { TabShellComponent } from 'src/app/core/main-screen/tab-shell.component';

@Component({
    selector: 'app-admin-manager',
    templateUrl: './admin-manager.component.html',
    styleUrls: ['./admin-manager.component.css'],
    standalone: false
})
export class AdminManagerComponent extends TabShellComponent {
  protected readonly groupId = 'admin-manager';

  /**
   * The only shell that gates on more than a permission grant.
   *
   * The E2E Dashboard is ROOT-only, which no grant can express -
   * canViewNavItem passes any Admin. Without this second check an Admin who
   * typed ?tab=e2e-dashboard would be let straight in, which is exactly the
   * direct-URL bypass TabShellComponent's empty `selectedTab` exists to
   * prevent.
   *
   * This used to live inline in a hand-copied ngOnInit, one of nine (sweep
   * P2). It is a hook now so the gating and the reasoning have one home and
   * a tenth manager cannot be created without one.
   * @param {NavLeaf[]} items Every screen in this group.
   * @param {unknown} user The signed-in user.
   * @return {NavLeaf[]} The visible subset.
   */
  protected override filterItems(items: NavLeaf[], user: unknown): NavLeaf[] {
    const isRoot = (user as { role?: string } | null)?.role === Role.ROOT;
    return super.filterItems(items, user)
      .filter((item) => item.slug !== 'e2e-dashboard' || isRoot);
  }
}
