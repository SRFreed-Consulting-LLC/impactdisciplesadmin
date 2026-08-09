import { Role } from 'src/app/common/lists/roles.enum';

// Single source of truth for the whole left nav: the 7 top-level entries
// (Home + the 6 "manager" modules) plus, for each manager, the sub-screens
// that used to live in that module's own top <app-section-tabs> bar (see
// commit that removed it). MainScreenComponent renders this tree directly;
// each manager component looks up its own group's `items` here instead of
// keeping a separate, duplicated local tabs array.
//
// `label` on a NavLeaf must exactly match the string that manager's own
// `selectedTab` / template *ngIf checks use - it's the same identifier,
// just sourced from one place now instead of two.
export interface NavLeaf {
  label: string;
  // ?tab= query param value used to deep-link here from outside the
  // manager (the left nav itself, or <app-new-record-alerts>). The 5 marked
  // below are load-bearing - NewRecordAlertsComponent already navigates
  // using these exact slugs, don't rename them without updating that too.
  slug: string;
  // Omit to inherit no extra restriction beyond the group's own `roles` -
  // matches today's behavior for Admin/Requests/Subscriptions/Web Manager,
  // none of which gate individual tabs, only the group itself.
  roles?: Role[];
}

export interface NavGroup {
  id: string; // also the route path segment, e.g. 'store-manager'
  label: string;
  icon: string; // mat-icon ligature name
  roles: Role[];
  items?: NavLeaf[]; // undefined = flat link (Home only)
}

export const NAV_CONFIG: NavGroup[] = [
  { id: 'home', label: 'HOME', icon: 'home', roles: [Role.ADMIN] },
  {
    id: 'admin-manager',
    label: 'ADMIN MANAGER',
    icon: 'admin_panel_settings',
    roles: [Role.ADMIN],
    items: [
      { label: 'Logs', slug: 'logs' },
      { label: 'Notifications', slug: 'notifications' },
      { label: 'Admin Users', slug: 'admin-users' },
      { label: 'Customers', slug: 'customers' },
      { label: 'Web Config', slug: 'web-config' },
      { label: 'Email Templates', slug: 'email-templates' },
      { label: 'Shipping Labels', slug: 'shipping-labels' }
    ]
  },
  {
    id: 'events-manager',
    label: 'EVENTS MANAGER',
    icon: 'event',
    roles: [Role.ADMIN, Role.EMPLOYEE],
    items: [
      { label: 'Events', slug: 'events', roles: [Role.ADMIN] },
      { label: 'Courses', slug: 'courses', roles: [Role.ADMIN] },
      { label: 'Coaches', slug: 'coaches', roles: [Role.ADMIN] },
      { label: 'Locations', slug: 'locations', roles: [Role.ADMIN] },
      { label: 'Organizations', slug: 'organizations', roles: [Role.ADMIN] }
    ]
  },
  {
    id: 'requests-manager',
    label: 'REQUESTS MANAGER',
    icon: 'notifications_none',
    roles: [Role.ADMIN],
    items: [
      // Slugs load-bearing - see NavLeaf.slug.
      { label: 'Consultation Requests', slug: 'consultation-requests' },
      { label: 'Consultation Surveys', slug: 'consultation-surveys' },
      { label: 'Lunch and Learn Requests', slug: 'lunch-and-learns' },
      { label: 'Seminar Requests', slug: 'seminars' }
    ]
  },
  {
    id: 'store-manager',
    label: 'STORE MANAGER',
    icon: 'storefront',
    roles: [Role.ADMIN, Role.EMPLOYEE],
    items: [
      { label: 'Products', slug: 'products', roles: [Role.ADMIN] },
      // Slug load-bearing - see NavLeaf.slug.
      { label: 'Purchases', slug: 'purchases', roles: [Role.ADMIN, Role.EMPLOYEE] },
      // Operational (packing/shipping), same role gating as Purchases.
      { label: 'Fulfillment', slug: 'fulfillment', roles: [Role.ADMIN, Role.EMPLOYEE] },
      { label: 'Coupons', slug: 'coupons', roles: [Role.ADMIN] },
      { label: 'Sales', slug: 'sales', roles: [Role.ADMIN] }
    ]
  },
  {
    id: 'subscriptions-manager',
    label: 'SUBSCRIPTIONS MANAGER',
    icon: 'mail',
    roles: [Role.ADMIN],
    items: [
      { label: 'Newsletters', slug: 'newsletters' },
      { label: 'Prayer Team', slug: 'prayer-team' }
    ]
  },
  {
    id: 'web-manager',
    label: 'WEB MANAGER',
    icon: 'handyman',
    roles: [Role.ADMIN],
    items: [
      { label: 'Disciple Making Minute', slug: 'disciple-making-minute' },
      { label: 'Pod Casts', slug: 'pod-casts' },
      { label: 'Testimonials', slug: 'testimonials' },
      { label: 'Home Page Images', slug: 'home-page-images' },
      { label: 'Home Page Popups', slug: 'home-page-popups' },
      { label: 'Monthly Newsletter', slug: 'monthly-newsletter' }
    ]
  }
];
