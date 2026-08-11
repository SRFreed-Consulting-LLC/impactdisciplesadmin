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
//
// This tree also doubles as the granular permission registry (see
// PermissionService) - a NavGroup/NavLeaf/NavTab's id/slug/key together
// form the dot-path "screenKey" a ScreenPermission grant is keyed by,
// instead of maintaining a second, parallel registry that could drift.

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
  // normal screen). Currently only Admin Users sets this, to close off
  // self-escalation (an Employee who could edit Admin Users could grant
  // themselves anything) - see PermissionService.canView().
  employeeGrantable?: boolean;
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
      // Never grantable to an Employee - see NavLeaf.employeeGrantable's own
      // comment. Admin/Root-only forever, regardless of the permission
      // system this field otherwise plugs into everywhere else.
      { label: 'Admin Users', slug: 'admin-users', employeeGrantable: false },
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
      // Slug load-bearing - see NavLeaf.slug.
      { label: 'Purchases', slug: 'purchases', roles: [Role.ADMIN] },
      // Operational (packing/shipping), same role gating as Purchases.
      { label: 'Fulfillment', slug: 'fulfillment', roles: [Role.ADMIN] },
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
      { label: 'Monthly Newsletter', slug: 'monthly-newsletter' },
      { label: 'Form Builder', slug: 'form-builder' },
      // Slug load-bearing - see NavLeaf.slug.
      { label: 'Custom Form Submissions', slug: 'custom-form-submissions' }
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
  }
];
