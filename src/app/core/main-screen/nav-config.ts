import { Role } from 'src/app/common/lists/roles.enum';

// Single source of truth for the whole left nav: the top-level entries
// (Home + the "manager" modules) plus, for each manager, the sub-screens
// that used to live in that module's own top <app-section-tabs> bar (see
// commit that removed it). MainScreenComponent renders this tree directly;
// each manager component looks up its own group's `items` here instead of
// keeping a separate, duplicated local tabs array.
//
// `label` on a NavLeaf must exactly match the string that manager's own
// `selectedTab` / template *ngIf checks use - it's the same identifier,
// just sourced from one place now instead of two.
//
// This tree also doubles as the granular permission registry (see
// PermissionService) - a NavGroup/NavLeaf/NavTab's id/slug/key together
// form the dot-path "screenKey" a ScreenPermission grant is keyed by,
// instead of maintaining a second, parallel registry that could drift.
//
// Reorganized (2026-08) around what a screen actually IS rather than which
// internal app area happened to own it originally:
//   - Customers Manager: customer records, plus anything a customer/site
//     visitor submitted - Customers, Purchases (+ Fulfillment, same order
//     lifecycle, just a different view of it), Custom Form Submissions,
//     Newsletters, Prayer Team. Absorbs the old Subscriptions Manager
//     entirely (Newsletters/Prayer Team are subscriber lists - customer
//     data too, not a separate concern).
//   - Tools Manager: utility/configuration screens, not records - Web
//     Config, Email Templates, Shipping Labels, Form Builder (the thing
//     that BUILDS a form, as opposed to Custom Form Submissions, which is
//     the data that comes back from one).
//   - Admin Manager still exists as a real module/route (Logs + Admin
//     Users need a shell to render into) but is no longer a visible left-
//     nav group - both its remaining items are hideFromNav +
//     employeeGrantable: false, reached only from the user-menu dropdown
//     (see main-screen.component.html). MainScreenComponent.secureNav
//     drops any group whose visible items filter down to empty, so this
//     doesn't show as a dead expandable header with nothing inside it.
// Moving a screen to a new group.id changes its permission-registry key
// (e.g. store-manager.purchases -> customers-manager.purchases) - fine
// here since no Employee had any grants at the time of this reorg
// (confirmed against dev's real admin_users data), but worth remembering
// if this pattern is ever repeated once real per-screen grants exist.

// An internal edit-view tab within a screen (e.g. Events' Info/Application/
// Agenda/Attendees/Break Outs mat-tab-group) - only Events has these today.
// `key` combines with its parent NavLeaf's own key to form a permission
// registry key, see PermissionService's comment on key construction.
export interface NavTab {
  key: string;
  label: string;
}

export interface NavLeaf {
  label: string;
  // ?tab= query param value used to deep-link here from outside the
  // manager (the left nav itself, or <app-new-record-alerts>). The 2 marked
  // below (Purchases, Custom Form Submissions) are load-bearing -
  // NewRecordAlertsComponent already navigates using these exact slugs,
  // don't rename them without updating that too.
  slug: string;
  // Omit to inherit no extra restriction beyond the group's own `roles` -
  // this still means "Admin/Root only" everywhere it appears; Employee
  // visibility no longer goes through `roles` at all, see PermissionService.
  roles?: Role[];
  // Internal edit-view tabs this screen has, if any - part of the
  // permission registry (PermissionService.buildPermissionTree()) alongside
  // this screen itself. Omit for screens with no internal tabs (everything
  // except Events today).
  tabs?: NavTab[];
  // false = hard-blocked from the granular permission system entirely -
  // never appears in the permissions-editing tree, never viewable by an
  // Employee no matter what's granted. Defaults to true (omit for every
  // normal screen). Currently Logs and Admin Users set this, to close off
  // self-escalation (an Employee who could edit Admin Users could grant
  // themselves anything) - see PermissionService.canView().
  employeeGrantable?: boolean;
  // true = never rendered as its own row in the left nav (drawer sub-item
  // list, or a "pin to top" shortcut) - still a real NAV_CONFIG entry
  // otherwise, so it keeps its permission-registry key, its manager-
  // component-style tab-shell content still resolves via ?tab=, and
  // (unless employeeGrantable is also false) it can still be reached by
  // anyone who has view rights, just not from the drawer. Currently Logs
  // and Admin Users set this - both linked from the user-menu dropdown
  // instead (see MainScreenComponent's template), not the left nav.
  // Defaults to false/omitted (every normal screen shows in the nav).
  hideFromNav?: boolean;
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
    id: 'customers-manager',
    label: 'CUSTOMERS MANAGER',
    icon: 'people',
    roles: [Role.ADMIN],
    items: [
      { label: 'Customers', slug: 'customers' },
      // Slug load-bearing - see NavLeaf.slug.
      { label: 'Purchases', slug: 'purchases' },
      // Operational (packing/shipping), same order lifecycle as Purchases -
      // a different view of the same records, not a separate concern.
      { label: 'Fulfillment', slug: 'fulfillment' },
      // Slug load-bearing - see NavLeaf.slug. Label reads "Form Submissions"
      // (shortened from "Custom Form Submissions") - the slug/screenKey
      // stay as-is on purpose, only the display label changed.
      { label: 'Form Submissions', slug: 'custom-form-submissions' },
      // Replaces the old separate Newsletters + Prayer Team entries - both
      // collections merged into one (`subscriptions`, annotated by `type`),
      // see SubscriptionModel's own comment for the full reasoning. Label
      // reads "Subscribers" (the people on the list) rather than
      // "Subscriptions" (the act) - slug/screenKey unchanged.
      { label: 'Subscribers', slug: 'subscriptions' }
    ]
  },
  {
    id: 'events-manager',
    label: 'EVENTS MANAGER',
    icon: 'event',
    roles: [Role.ADMIN],
    items: [
      {
        label: 'Events', slug: 'events', roles: [Role.ADMIN],
        // events.component.html's mat-tab-group - the one screen in the app
        // with internal edit-view tabs today.
        tabs: [
          { key: 'info', label: 'Info' },
          { key: 'application', label: 'Application' },
          { key: 'agenda', label: 'Agenda' },
          { key: 'attendees', label: 'Attendees' },
          { key: 'breakouts', label: 'Break Outs' }
        ]
      },
      { label: 'Courses', slug: 'courses', roles: [Role.ADMIN] },
      { label: 'Coaches', slug: 'coaches', roles: [Role.ADMIN] },
      { label: 'Locations', slug: 'locations', roles: [Role.ADMIN] },
      { label: 'Organizations', slug: 'organizations', roles: [Role.ADMIN] }
    ]
  },
  {
    id: 'store-manager',
    label: 'STORE MANAGER',
    icon: 'storefront',
    roles: [Role.ADMIN],
    items: [
      { label: 'Products', slug: 'products', roles: [Role.ADMIN] },
      { label: 'Coupons', slug: 'coupons', roles: [Role.ADMIN] },
      { label: 'Sales', slug: 'sales', roles: [Role.ADMIN] }
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
  },
  {
    id: 'tools-manager',
    label: 'TOOLS MANAGER',
    icon: 'build',
    roles: [Role.ADMIN],
    items: [
      { label: 'Web Config', slug: 'web-config' },
      { label: 'Email Templates', slug: 'email-templates' },
      { label: 'Shipping Labels', slug: 'shipping-labels' },
      { label: 'Form Builder', slug: 'form-builder' },
      { label: 'Mailchimp', slug: 'mailchimp' }
    ]
  },
  {
    id: 'reports-manager',
    label: 'REPORTS MANAGER',
    icon: 'assessment',
    roles: [Role.ADMIN],
    items: [
      { label: 'Purchases', slug: 'purchases' }
    ]
  },
  {
    id: 'admin-manager',
    label: 'ADMIN MANAGER',
    icon: 'admin_panel_settings',
    roles: [Role.ADMIN],
    items: [
      // Admin/Root-only and hidden from the left nav - reached from the
      // user-menu dropdown instead (see main-screen.component.html). This
      // group has no other members, so it never renders as a left-nav row
      // at all (see MainScreenComponent.secureNav's own comment).
      { label: 'Logs', slug: 'logs', employeeGrantable: false, hideFromNav: true },
      { label: 'Admin Users', slug: 'admin-users', employeeGrantable: false, hideFromNav: true }
    ]
  }
];
