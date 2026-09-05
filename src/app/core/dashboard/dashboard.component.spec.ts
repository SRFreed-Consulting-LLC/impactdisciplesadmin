import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { DASHBOARD_SECTION_KEYS, DashboardComponent } from './dashboard.component';
import { PermissionService } from 'src/app/common/services/permission.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { SitePagesNavService } from 'src/app/core/main-screen/site-pages-nav.service';
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
  }): { component: DashboardComponent; loads: jasmine.Spy[]; navigate: jasmine.Spy } {
    const navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
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
        { provide: SitePagesNavService, useValue: { leaves: options.pages ?? [], leaves$: of(options.pages ?? []) } },
        { provide: Router, useValue: { navigate } }
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
    return { component, loads, navigate };
  }

  it('Admin/Root: every preview shows and loads, there is no screen list, and they stay on Home', () => {
    const { component, loads, navigate } = build({ fullAccess: true, visible: [] });
    expect(component.access).toEqual({ orders: true, events: true, requests: true });
    loads.forEach((load) => expect(load).toHaveBeenCalledTimes(1));
    expect(component.myScreens).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a non-Administrator is sent straight to the first screen they hold, once', () => {
    // Owner's call, 2026-09-03: no HOME for them - one screen means land on
    // it, several means land on the first. replaceUrl, so Back does not
    // bounce through Home.
    const { navigate } = build({
      fullAccess: false,
      visible: ['page-manager.coaching-with-impact', 'data.disciple-making-minute'],
      pages: [{ label: 'Coaching with Impact', slug: 'coaching-with-impact' }]
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/page-manager'], { queryParams: { tab: 'coaching-with-impact' }, replaceUrl: true });
  });

  it('a non-Administrator granted nothing stays on Home to read the message', () => {
    const { component, navigate } = build({ fullAccess: false, visible: [] });
    expect(component.myScreens).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
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
    // Group names as the drawer shows them - "PAGES", never "PAGE MANAGER".
    expect(component.myScreens.map((s) => s.group)).toEqual(['PAGES', 'DATA']);
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
