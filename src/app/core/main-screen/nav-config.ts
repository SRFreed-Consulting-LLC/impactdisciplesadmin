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
//   - Contacts Manager (nee Customers Manager): contact records, plus
//     anything a contact/site visitor submitted - Contacts, Purchases
//     (+ Fulfillment, same order
//     lifecycle, just a different view of it), Custom Form Submissions.
//     Originally absorbed the old Subscriptions Manager (Newsletters/
//     Prayer Team) here too, but that screen was removed outright
//     2026-08-15 once subscriber state became just 2 flags on a customer
//     record - see Reports Manager's own Subscribers report below, which
//     absorbed its functionality instead.
//   - Tools Manager: utility/configuration screens, not records - Email
//     Templates, Shipping Labels, Form Builder (the thing
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
// (e.g. store-manager.purchases -> contacts-manager.purchases) - fine
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
    id: 'contacts-manager',
    label: 'CONTACTS MANAGER',
    icon: 'people',
    roles: [Role.ADMIN],
    items: [
      // Renamed Customers -> Contacts 2026-08-19 (app-wide vocabulary
      // change, user-requested). The Firestore collection stays `customers`
      // - only labels and code identifiers changed; slug/screenKey renames
      // were migrated for stored grants (scripts/migrate-screenkey-renames.js).
      { label: 'Contacts', slug: 'contacts' },
      // Moved from Events Manager 2026-08-19 (Contacts & Events
      // restructure): an organization is a contact-world record - orgs we
      // keep in contact with, plus the people inside them. Its child
      // locations are managed inside the org details view (the standalone
      // Locations screen is retired). Stored grants migrated by
      // scripts/migrate-screenkey-renames-2.js.
      { label: 'Organizations', slug: 'organizations' },
      // Slug load-bearing - see NavLeaf.slug.
      { label: 'Purchases', slug: 'purchases' },
      // Operational (packing/shipping), same order lifecycle as Purchases -
      // a different view of the same records, not a separate concern.
      { label: 'Fulfillment', slug: 'fulfillment' },
      // Slug load-bearing - see NavLeaf.slug. Label reads "Form Submissions"
      // (shortened from "Custom Form Submissions") - the slug/screenKey
      // stay as-is on purpose, only the display label changed.
      { label: 'Form Submissions', slug: 'custom-form-submissions' }
      // No more standalone Subscribers screen here (removed 2026-08-15) -
      // subscriber management (Add/Edit, Unsubscribe, Send Newsletter/
      // Prayer Request, list-building) folded entirely into Reports
      // Manager's own Subscribers report (below) once a subscriber became
      // just a filtered/actionable view of `customers`, not a separate
      // screen's worth of concern - see subscriber-report.component.ts's
      // own header comment.
    ]
  },
  {
    id: 'events-manager',
    label: 'EVENTS MANAGER',
    icon: 'event',
    roles: [Role.ADMIN],
    items: [
      {
        label: 'Summit', slug: 'summit', roles: [Role.ADMIN],
        // Summit events (isSummit: true) only - events.component.ts's
        // EventsComponent rendered with [summitMode]="true". Own permission
        // grant, deliberately separate from 'Events' below (confirmed with
        // the user during the Summit/Events nav split) - Summit is the
        // higher-stakes, more specialized screen (multi-day agenda,
        // breakout capacity), an Employee needs it granted explicitly, an
        // existing 'Events' grant does not carry over.
        // Break Outs tab removed (2026-08) - superseded by Reports Manager's
        // own Event Report breakout view (reports-manager/event-report/),
        // which covers the same "who's signed up for which breakout"
        // question without needing a dedicated in-editor tab.
        tabs: [
          { key: 'info', label: 'Info' },
          { key: 'application', label: 'Application' },
          { key: 'agenda', label: 'Agenda' },
          { key: 'attendees', label: 'Attendees' }
        ]
      },
      {
        label: 'Events', slug: 'events', roles: [Role.ADMIN],
        // Regular (non-Summit) events only - EventsComponent rendered with
        // [summitMode]="false". Only 2 internal tabs (Details/Attendees) -
        // Application/Agenda/Break Outs don't exist on this screen at all,
        // see events.component.ts/html's own comments on why (real
        // usage data: those 3 are used by 0-1 of 27 regular events in dev).
        tabs: [
          { key: 'info', label: 'Details' },
          { key: 'attendees', label: 'Attendees' }
        ]
      },
      // Edit-only roster (photo/bio/organization upkeep) - NEW coaches are
      // created exclusively from the Summit screen's agenda dialogs since
      // the 2026-08-19 restructure (user decision), see
      // coach-quick-create-dialog.component.ts.
      { label: 'Coaches', slug: 'coaches', roles: [Role.ADMIN] }
      // Courses, Locations, and Organizations all left this group
      // 2026-08-19 (Contacts & Events restructure): Organizations moved to
      // Contacts Manager; the Locations screen is retired outright
      // (locations are child records edited inside an organization's
      // details view, the Summit venue's rooms on the Summit screen); and
      // the Courses CONCEPT is retired - a breakout agenda item carries its
      // own title/description/coaches now (see agenda-item.model.ts).
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
    id: 'content-manager',
    label: 'CONTENT MANAGER',
    icon: 'handyman',
    roles: [Role.ADMIN],
    items: [
      { label: 'Disciple Making Minute', slug: 'disciple-making-minute' },
      // Moved from Tools Manager 2026-08-19 alongside the Web Manager ->
      // Content Manager rename: the public site's configuration belongs
      // with the rest of the public-site content.
      { label: 'Web Config', slug: 'web-config' },
      { label: 'Pod Casts', slug: 'pod-casts' },
      { label: 'Testimonials', slug: 'testimonials' },
      { label: 'Home Page Images', slug: 'home-page-images' },
      // 'Home Page Popups' retired 2026-08-19 (Campaign Manager v2 Phase
      // 6): the public site never had a renderer for home_page_popups (the
      // screen wrote docs nothing read); web-campaign popups (Campaigns
      // Manager -> a campaign's Add Popup) are THE popup mechanism now.
      // The home_page_popups collection's docs are left inert.
      { label: 'Monthly Newsletter', slug: 'monthly-newsletter' },
      // Split off Coaches (2026-08, Events Manager) - the public-facing
      // "My Team" page's own records, administered here since Web Manager
      // owns public site content; still independently pickable as a
      // breakout instructor (see course-dialog.component.ts's combined
      // Coaches + Impact Team picker) - see impact-team.service.ts's own
      // header comment.
      { label: 'Team Page', slug: 'team-page' }
    ]
  },
  {
    id: 'tools-manager',
    label: 'TOOLS MANAGER',
    icon: 'build',
    roles: [Role.ADMIN],
    items: [
      // The full-screen email builder route (/tools-manager/email-designer/
      // new | :id) deliberately has NO NavLeaf/screenKey of its own - it is
      // Email Templates' editing surface and rides this entry's grants
      // (EmailDesignerComponent checks canAdd/canEdit on
      // tools-manager.email-templates and bounces back here if denied).
      { label: 'Email Templates', slug: 'email-templates' },
      { label: 'Shipping Labels', slug: 'shipping-labels' },
      { label: 'Form Builder', slug: 'form-builder' }
    ]
  },
  {
    // Added 2026-08-15 (feature/campaign-manager) - marketing campaigns
    // pushing a product, an event, or a lead-capture offer (name+email for
    // a store discount). Records + workflow, so its own group rather than a
    // Tools screen. Both leaves are tab-shell screens; the Composer (create/
    // edit, incl. the template gallery) is an in-page mode inside each of
    // them - same "full in-page editor, no route" treatment as Products
    // (see products.component.ts's own comment) - so it needs no NavLeaf/
    // screenKey of its own: create/edit rights ride the hosting screen's
    // add/edit grants.
    id: 'campaigns-manager',
    label: 'CAMPAIGNS MANAGER',
    icon: 'campaign',
    roles: [Role.ADMIN],
    items: [
      { label: 'Campaigns', slug: 'campaigns' },
      { label: 'Status Board', slug: 'status-board' },
      // Email-campaign HISTORY (type 'email' - the imported Mailchimp
      // archive today, this app's own future one-time sends later).
      // Read-only: preview + copy-into-designer, never edit/re-send.
      { label: 'Sent Emails', slug: 'sent-emails' },
      // Customer tag rules ("purchased X => tag 'Impact 1'") live here
      // rather than Tools because they exist to feed campaign audiences -
      // they're campaign infrastructure, and keeping them in this group
      // keeps the "can work campaigns" permission story one grant.
      { label: 'Tag Rules', slug: 'tag-rules' },
      // Moved from Tools Manager 2026-08-18 under the app's email taxonomy
      // (transactional emails = system-sent receipts/confirmations, campaign
      // emails = admin-initiated outreach): the Mailchimp sync is audience
      // infrastructure for campaign email, not a generic utility. No stored
      // grants existed on the old tools-manager.mailchimp key in dev or prod
      // at move time, so no grant migration was needed.
      { label: 'Mailchimp', slug: 'mailchimp' }
    ]
  },
  {
    id: 'reports-manager',
    label: 'REPORTS MANAGER',
    icon: 'assessment',
    roles: [Role.ADMIN],
    items: [
      { label: 'Purchases', slug: 'purchases' },
      { label: 'Subscribers', slug: 'subscribers' },
      { label: 'Contacts', slug: 'contacts' },
      { label: 'Events', slug: 'events' }
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
  },
  {
    // Added as part of the impact-discipleship-library-manager-new
    // consolidation (Phase 2, Slice 1 - scaffolding). Visible to Admin/Root
    // (full access, as everywhere) and Role.EDITOR (the former library
    // manager app's own staff, hard-scoped to only this group - see
    // PermissionService.canView()'s own comment). Not Employee - every item
    // below is employeeGrantable: false so it never appears in the Employee
    // permissions-editing table at all, on top of PermissionService's own
    // hard block. `roles` here is otherwise-unused vestigial documentation
    // in this codebase (see PermissionService/MainScreenComponent - actual
    // gating is canView()-driven, not this field) but left accurate anyway.
    id: 'library-manager',
    label: 'LIBRARY MANAGER',
    icon: 'menu_book',
    roles: [Role.ADMIN, Role.EDITOR],
    items: [
      // Slice 1: read-only Series/Book/Unit/Lesson drill-down, proving the
      // named-database service pattern end to end. Later slices add the
      // real authoring screens (Lesson Editor, Translations, Templates, AI
      // Book Import), Users, Library Users, Groups, Config, Activity Log,
      // World Map - each its own NavLeaf here as it lands.
      { label: 'Browse', slug: 'browse', employeeGrantable: false },
      // Slice 2: list/create/delete subtemplates (header/footer/layout
      // pieces reused across lessons). Editing one opens the full-page
      // Subtemplate Editor route (library-manager/subtemplates/:id), not a
      // tab - same "tab-shell lists, full page edits" split as Lesson
      // Editor/Preview vs. Browse.
      { label: 'Subtemplates', slug: 'subtemplates', employeeGrantable: false },
      // Slice 2: composes a header/layout/footer subtemplate combo for reuse
      // at lesson-creation time (not wired up yet - Browse has no "New
      // Lesson" flow, see LessonTemplateEditorComponent's own doc comment).
      { label: 'Lesson Templates', slug: 'lesson-templates', employeeGrantable: false },
      // Slice 4: app-wide Library staff config - currently just the
      // bulk-purchase discount tiers a group leader's license purchase is
      // priced against.
      { label: 'Config', slug: 'config', employeeGrantable: false },
      // Slice 4: world map of where library users are using the reader app
      // (IP-derived login locations) - a plain inline tab here rather than
      // the source app's auto-opening dialog, per the consolidation plan's
      // "becomes a real menu item" decision.
      { label: 'World Map', slug: 'world-map', employeeGrantable: false },
      // Slice 4: admin moderation of Impact Groups (list/edit/hard-delete
      // any group, regardless of status/visibility) - no dependent Cloud
      // Functions, both mutations are direct rules-gated Firestore writes.
      { label: 'Groups', slug: 'groups', employeeGrantable: false },
      // Slice 4 part 4: reader-app library users roster (a different
      // population from this app's own admin_users staff) - detail/edit,
      // revoke/restore access, license grants, and messaging are all
      // full-page routes reached from here (library-users/:email,
      // library-users/messages), not further tabs.
      { label: 'Library Users', slug: 'library-users', employeeGrantable: false },
      // Slice 5: account/access + content-edit audit trail. Named
      // "Activity Log", not "Events" like the source app - this app
      // already has a real, unrelated "/events" section.
      { label: 'Activity Log', slug: 'activity-log', employeeGrantable: false }
    ]
  }
];
