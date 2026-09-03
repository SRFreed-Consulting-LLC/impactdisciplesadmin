import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { DASHBOARD_SECTION_KEYS, DashboardComponent } from './dashboard.component';
import { PermissionService } from 'src/app/common/services/permission.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { SitePagesNavService } from 'src/app/page-manager/pages/site-pages-nav.service';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { LocationService } from 'src/app/common/services/data/location.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';

// Home is gated per section since 2026-09-03: a preview shows only to
// someone who could open the screen it belongs to, and an Employee gets the
// list of screens they hold instead. These pin the two halves that would
// fail silently - a preview LOADING for someone who cannot see it (the leak
// is the data read, not the render), and the list disagreeing with the
// drawer about what somebody holds.
//
// TestBed as an injector only (no template): the component takes three
// services through inject(), so `new` outside an injection context throws
// NG0203. The constructor services are never touched by what is asserted
// here, so they are inert stubs.
describe('DashboardComponent (permission-gated Home)', () => {
  function build(options: {
    fullAccess: boolean;
    visible: string[];
    pages?: { label: string; slug: string }[];
  }): { component: DashboardComponent; loads: jasmine.Spy[] } {
    const permissionService = {
      isFullAccess: () => options.fullAccess,
      canView: (key: string) => options.fullAccess || options.visible.includes(key),
      canViewNavItem: (group: { id: string }, item: { slug: string }) =>
        options.fullAccess || options.visible.includes(`${group.id}.${item.slug}`)
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PermissionService, useValue: permissionService },
        { provide: AdminAuthService, useValue: { dao: { loggedInUser$: of({ role: 'Employee' }) } } },
        { provide: SitePagesNavService, useValue: { leaves: options.pages ?? [], leaves$: of(options.pages ?? []) } }
      ]
    });
    const component = TestBed.runInInjectionContext(() => new DashboardComponent(
      {} as unknown as PurchasesService,
      {} as unknown as EventService,
      {} as unknown as LocationService,
      {} as unknown as EventRegistrationService,
      {} as unknown as FormSubmissionService,
      {} as unknown as MatDialog
    ));
    const loads = [
      spyOn(component, 'loadRecentOrders'),
      spyOn(component, 'loadUpcomingEvents'),
      spyOn(component, 'loadNewRequests')
    ];
    component.ngOnInit();
    return { component, loads };
  }

  it('Admin/Root: every preview shows and loads, and there is no screen list', () => {
    const { component, loads } = build({ fullAccess: true, visible: [] });
    expect(component.access).toEqual({ orders: true, events: true, requests: true });
    loads.forEach((load) => expect(load).toHaveBeenCalledTimes(1));
    expect(component.myScreens).toEqual([]);
  });

  it('an Employee with no preview grants: nothing is loaded, not merely hidden', () => {
    const { component, loads } = build({
      fullAccess: false,
      visible: ['page-manager.coaching-with-impact', 'data.disciple-making-minute'],
      pages: [{ label: 'Coaching with Impact', slug: 'coaching-with-impact' }, { label: 'About Us', slug: 'about-us' }]
    });
    expect(component.access).toEqual({ orders: false, events: false, requests: false });
    loads.forEach((load) => expect(load).not.toHaveBeenCalled());
    // The list is exactly the granted screens, drawer order, streamed pages
    // included and ungranted ones (About Us) left out.
    expect(component.myScreens.map((s) => `${s.path}?tab=${s.tab}`)).toEqual([
      '/page-manager?tab=coaching-with-impact',
      '/data?tab=disciple-making-minute'
    ]);
    expect(component.myScreens[0].label).toBe('Coaching with Impact');
  });

  it('an Employee granted Fulfillment sees and loads Recent Orders only', () => {
    const { component, loads } = build({ fullAccess: false, visible: [DASHBOARD_SECTION_KEYS.orders] });
    expect(component.access).toEqual({ orders: true, events: false, requests: false });
    expect(loads[0]).toHaveBeenCalledTimes(1);
    expect(loads[1]).not.toHaveBeenCalled();
    expect(loads[2]).not.toHaveBeenCalled();
  });

  it('the section keys name real screens', () => {
    // A typo here would hide a preview from everyone but Admin and nobody
    // would notice - Admin short-circuits the check.
    expect(Object.values(DASHBOARD_SECTION_KEYS)).toEqual([
      'contacts-manager.fulfillment', 'events-manager.events', 'data.custom-form-submissions'
    ]);
  });
});
