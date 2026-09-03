import { Role } from '@impact-common/shared/lists/roles.enum';

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
//   - Tools Manager: utility/configuration screens, not records - System
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

// ---- Drawer sections (2026-08-29, owner's call) ----
//
// The drawer is split into TABS, and a group declares which one it lives
// under. This is a rank ABOVE the group, which is what makes it cheap:
// unlike moving a screen between groups (see the screenKey warning at the
// top of this file), it changes NO identity at all. A screenKey is still
// `group.id` + `leaf.slug`, every route and bookmark still resolves, and
// not one stored ScreenPermission grant has to be migrated. Moving a
// manager to another tab is one word on its group.
export type NavSection = 'admin' | 'site' | 'library';

export interface NavSectionDef {
  id: NavSection;
  label: string;
  /**
   * Who may see this TAB at all (2026-08-30, owner's call).
   *
   * A gate ABOVE the granular permission system, and the only one: the items
   * on a tab still follow their own grants exactly as before. This exists so
   * "who can touch the public website" is one decision rather than something
   * inferred from whichever screens happen to be granted.
   *
   * Omit for no role gate - the tab shows whenever any of its items does,
   * which is what Library wants.
   *
   * ENFORCED IN TWO PLACES, and it has to be. MainScreenComponent hides the
   * tab; PermissionService.canView() refuses the screens under it. Hiding a
   * tab is presentation - without the second half, a direct URL still lets a
   * granted Employee into a Site screen.
   */
  roles?: Role[];
  // true = render this section's screens as ONE flat list, with no
  // expandable group header above them. Worth doing only where the header
  // would repeat what the tab already says - Library today. Site
  // deliberately KEEPS its header (owner's call) even though it holds a
  // single group, because it is the one expected to gain more.
  //
  // A section holding two or more groups must never flatten, or the groups
  // merge into one undifferentiated list with nothing naming either -
  // nav-config.spec.ts pins that, since the failure is silent.
  flatten?: boolean;
}

// Tab order, left to right. `roles` is the tab-level gate - see
// NavSectionDef.roles. Root is not listed anywhere: hasRole() gives it
// everything Admin has, so listing it would be noise that can drift.
export const NAV_SECTIONS: NavSectionDef[] = [
  // The back office. Employees work here, subject to their own grants.
  { id: 'admin', label: 'Admin', roles: [Role.ADMIN, Role.EMPLOYEE] },
  // The PUBLIC WEBSITE. Administrators and Root see all of it; an Employee
  // sees exactly the Site screens they hold a grant on, and nothing else.
  //
  // Until 2026-09-03 this was Admin/Root only - "what a visitor sees is not
  // delegated, whatever an Employee may be granted underneath" (owner,
  // 2026-08-30). Reversed by the owner the same week, for an Employee who
  // administers Coaching with Impact and Disciple Making Minute and nothing
  // else: delegating PORTIONS of the site (a page, a record list) is the
  // pattern going forward, the same way portions of the back office are.
  // The tab-level gate still exists - it is what keeps Editors out - and the
  // per-screen grant decides everything past it: the drawer, TabShell and
  // PermissionService.canView() all filter Site leaves (the static ones and
  // the pages streamed from page_content) through canViewNavItem(), so an
  // Employee granted one page cannot reach a second by typing its URL.
  { id: 'site', label: 'Site', roles: [Role.ADMIN, Role.EMPLOYEE] },
  // No role gate: everybody who has anything granted under Library sees it.
  // In practice that is Admin/Root and Editors, because every Library leaf
  // is employeeGrantable: false - but that is the ITEMS deciding, which is
  // how it should be, rather than a second rule here that could disagree.
  { id: 'library', label: 'Library', flatten: true }
];

/** A group's section, with the 'admin' default applied - so moving a group
 *  to another tab stays a one-line edit and the majority stay unannotated. */
export function sectionOf(group: NavGroup): NavSection {
  return group.section ?? 'admin';
}

/**
 * The tab a screenKey belongs to, resolved from the key's own first segment.
 *
 * Takes a KEY rather than a group so PermissionService can apply the
 * tab-level gate without knowing about groups - a screenKey is
 * `group.id` + `.` + `leaf.slug`, so the group id is simply everything
 * before the first dot.
 */
export function sectionOfKey(key: string): NavSection | undefined {
  const groupId = String(key ?? '').split('.')[0];
  const group = NAV_CONFIG.find((g) => g.id === groupId);
  return group ? sectionOf(group) : undefined;
}

/** The role gate on a tab, if it has one. */
export function sectionRoles(section: NavSection | undefined): Role[] | undefined {
  return section ? NAV_SECTIONS.find((s) => s.id === section)?.roles : undefined;
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
  // Which drawer TAB this group appears under - see NavSection above. Omit
  // for 'admin', which is most of them.
  section?: NavSection;
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
      // Form Submissions moved to DATA on 2026-08-30.
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
      // Products moved to DATA on 2026-08-30 - this group keeps the money.
      { label: 'Coupons', slug: 'coupons', roles: [Role.ADMIN] }
    ]
  },
  {
    // NAVIGATION - the public site's top menu, a screen of its own rather
    // than a Page Manager tab (2026-08-30, owner's call). The menu is the
    // site's FRAME rather than any one page's content: it is on every page,
    // and it is the only thing on the Site tab that is not a page.
    //
    // A flat link, like Home - no `items`, so no ?tab= and no sub-rows. That
    // has one consequence worth knowing: PermissionService.buildPermissionTree()
    // skips groups with no items, so this screen is Admin/Root only and
    // cannot be granted to an Employee, where it could be as a leaf. If an
    // Employee ever needs the menu, it has to grow a leaf of its own.
    id: 'navigation',
    // 'HEADER', not 'NAVIGATION' (owner, 2026-09-01). It edits the site's
    // top bar, and it sits beside FOOTER and DOCKING BAR - three bands of
    // site furniture that read as a set only if each is named after the
    // band it edits. The id stays `navigation`: it is the first segment of
    // every screenKey under it and renaming it would orphan any grant.
    label: 'HEADER',
    icon: 'menu',
    roles: [Role.ADMIN],
    section: 'site'
  },
  {
    id: 'page-manager',
    // 'PAGES', not 'PAGE MANAGER' (owner, 2026-09-01). displayGroupLabel()
    // strips a trailing " Manager", so the drawer was rendering the plural
    // group as the singular "PAGE". Its leaves are pages, and there is more
    // than one of them. The id stays `page-manager` for the screenKeys.
    label: 'PAGES',
    icon: 'handyman',
    roles: [Role.ADMIN],
    // The SITE tab - everything that decides what a visitor to
    // impactdisciples.com sees. On its own tab since 2026-08-29: it is the
    // one group whose audience is the public rather than the back office,
    // and at 17 screens it was longer than every other manager combined.
    section: 'site',
    items: [
      // Navigation was a leaf here for a day (2026-08-29/30). It is its own
      // top-level group now - see the NAVIGATION entry above Page Manager.
      // HOME (2026-08-29): the home page's own sections, gathered onto one
      // screen in the order a visitor meets them. Today that is the slider
      // (formerly the standalone 'Home Page Images' screen); the services
      // strip and testimonials are expected to follow, which is why this is
      // a section stack rather than a renamed list.
      // Home is a KIT PAGE since 2026-08-31 - page_content/home - so it
      // streams into this group from Firestore with every other page,
      // pinned first by SitePagesNavService. A static leaf here as well
      // would show it twice.
      // Disciple Making Minute moved to DATA on 2026-08-31 - see that group.
      // Web Config moved to DATA on 2026-08-31 (owner's call) - see that
      // group. It is site-wide settings rather than any one page's content,
      // which the field-by-field audit that morning made plain: the address,
      // the phone number and the socials are read by the footer, the emails,
      // the checkout and the shipping labels as well as by pages.

      // 'Home Page Popups' retired 2026-08-19 (Campaign Manager v2 Phase
      // 6): the public site never had a renderer for home_page_popups (the
      // screen wrote docs nothing read); web-campaign popups (Campaigns
      // Manager -> a campaign's Add Popup) are THE popup mechanism now.
      // The home_page_popups collection's docs are left inert.
      // 'Monthly Newsletter' retired 2026-08-20: the public page now lists
      // campaign_emails touches flagged publishToWeb (Campaigns Manager ->
      // campaign detail -> "Show on website", or the Subscriber Report
      // send dialog's checkbox) via the newsletter_archive function; the
      // hand-maintained `monthly-newsletter` collection of Mailchimp links
      // is dead (see MIGRATION.md for the prod backfill/cleanup).
      // Split off Coaches (2026-08, Events Manager) - the public-facing
      // "My Team" page's own records, administered here since Web Manager
      // owns public site content; still independently pickable as a
      // breakout instructor (see course-dialog.component.ts's combined
      // Coaches + Impact Team picker) - see impact-team.service.ts's own
      // header comment.
      // Every remaining public page, added 2026-08-29. One screen
      // (page-stack.component) serves them all: an ordered stack of sections
      // with a pop-up editor each and a preview of the whole page. Which
      // sections a page can have is declared once in
      // page-manager/pages/page-section-catalogue.ts, and the LABEL here must
      // match that entry's `label` because TabShell selects by label. Their
      // content lives in `page_content`, one doc per page.
      //
      // Pages NOT listed here are already editable somewhere else and would
      // be a second source of truth if they were: Store/E-Books (Products),
      // Events and Summit (Events Manager), Impact Groups (the reader's
      // groups), Monthly Newsletter (Campaigns), Customer Reviews
      // (Testimonials), Privacy/Terms (Web Config), Disciple-Making Minute
      // (its own screen above), and the cart/checkout flow, which is
      // behaviour rather than content.
      // PAGES STAFF CREATE do not get entries here - a leaf is code and they
      // are data. They stream in from page_content (SitePagesNavService) and
      // the drawer appends them after the leaves below, alongside a
      // "+ New Page" row (Shane's call, 2026-08-30: no Pages list screen at
      // all - the left nav IS the list). The twelve below stay hardcoded
      // only until each migrates onto the kit and carries its own title.
    ]
  },
  {
    // FOOTER - the other half of the site's frame, and the same shape of
    // screen as Navigation above: a flat link, Admin/Root only, outside the
    // granular permission system for the same reason.
    //
    // Its headings, link columns and copyright live in `site_footer`. The
    // address, phone, email and social links do NOT - those are on
    // web_config, which the footer now reads instead of the hardcoded second
    // copy it used to.
    id: 'footer',
    label: 'FOOTER',
    icon: 'vertical_align_bottom',
    roles: [Role.ADMIN],
    section: 'site',
    // IT STOPPED BEING A FLAT LINK on 2026-09-01, when the docking bar
    // moved here out of Web Config. Two consequences worth knowing:
    //
    // The footer editor is now a LEAF rather than the group itself, so
    // reaching it is one click further - the trade for the dock having a
    // home that is not a settings form.
    //
    // A flat link is outside the granular permission system entirely
    // (buildPermissionTree skips groups with no items), so both screens
    // become grantable to an Employee for the first time. No stored grant
    // was affected: nothing in dev OR prod held one mentioning footer.
    items: [
      { label: 'Footer', slug: 'footer' },
      // The strip fixed to the bottom of every page. It was two tabs deep
      // in Web Config - site furniture living in a settings form, which is
      // the same complaint that moved Privacy Policy and Terms out to
      // pages of their own.
      { label: 'Docking Bar', slug: 'docking-bar' }
    ]
  },
  {
    // DATA (2026-08-30, owner's call) - the RECORDS the public site is built
    // out of, gathered from four different managers by what they are rather
    // than by which module happened to own them. Last on the Site tab: you
    // arrange the site's frame and its pages first, and these are what fills
    // them.
    //
    // Each of these is a list of records the site renders, as distinct from
    // a page's own words (Page Manager), the site's frame (Navigation), or a
    // back-office process (orders, campaigns, shipping).
    //
    // THIS MOVE CHANGED FIVE SCREENKEYS - page-manager.testimonials became
    // data.testimonials, store-manager.products became data.products, and so
    // on. Unlike a section change, that IS an identity change: stored
    // ScreenPermission grants were migrated by
    // scripts/migrate-screenkey-renames-3.js, run on dev. The production run
    // is written up in MIGRATION.md and has NOT been done.
    id: 'data',
    label: 'DATA',
    icon: 'inventory_2',
    roles: [Role.ADMIN],
    section: 'site',
    items: [
      { label: 'Products', slug: 'products', roles: [Role.ADMIN] },
      { label: 'Testimonials', slug: 'testimonials' },
      { label: 'Team Page', slug: 'team-page' },
      // Moved here from Page Manager 2026-08-31 (owner's call), the same
      // reasoning as Testimonials and Team Page the day before: a list of
      // records the public site renders, not one page's own words. This
      // changed its screenKey from page-manager.disciple-making-minute to
      // data.disciple-making-minute - an identity change, and normally a
      // grant migration. None was needed: no admin_user in dev OR prod held
      // a grant on the old key (both read before the move).
      { label: 'Disciple Making Minute', slug: 'disciple-making-minute' },
      // Slug unchanged from its Contacts Manager days on purpose:
      // NewRecordAlertsComponent navigates using this exact string, and the
      // label already reads shorter than the slug does.
      { label: 'Form Submissions', slug: 'custom-form-submissions' },
      // Sits beside the submissions its forms produce, which is the pairing
      // that was split across two managers before.
      { label: 'Form Builder', slug: 'form-builder' },
      // Moved here from Page Manager 2026-08-31 (owner's call). Every other
      // leaf in this group is a list of RECORDS and this one is settings,
      // which is a fair objection - but it is site-wide either way, and it
      // was the last thing in Page Manager that was not a page. The audit
      // that prompted the move found its address, phone and socials read by
      // the footer, the admin's email branding, the checkout and the
      // shipping function, none of which is a page.
      //
      // screenKey CHANGED: page-manager.web-config -> data.web-config. That
      // is an identity change and normally a grant migration; none was
      // needed, because no admin_user in dev OR prod held a grant
      // mentioning web-config at all (both read before the move).
      { label: 'Web Config', slug: 'web-config' }
    ]
  },
  {
    id: 'tools-manager',
    label: 'TOOLS MANAGER',
    icon: 'build',
    roles: [Role.ADMIN],
    items: [
      // Renamed from 'Email Templates' 2026-08-21 when campaign templates
      // were split out: this screen is now ONLY the templates the app
      // itself sends from - sales receipts, event registration
      // confirmations, product follow-ups - each resolved by name or id
      // inside a Cloud Function. Marketing templates live in the campaign
      // email editor's own gallery and never appear here (see
      // MailTemplateModel's 'kind').
      //
      // System Templates was REMOVED 2026-08-27. Every mail_template now
      // carries a kind naming the screen that owns it and is edited from the
      // process that sends it - an event's Info tab, a product's follow-up
      // list, Products' Order Receipt - so the flat list had nothing left in
      // it. See docs/email-taxonomy.md.
      //
      // The full-screen email builder outlived it and needs a grant of its
      // own: it is reachable from five different managers, and a direct URL
      // visit has no calling screen to borrow permission from. hideFromNav
      // because there is nothing useful to land on without a template to
      // edit. Stored grants were migrated off tools-manager.system-templates
      // by scripts/migrate-email-designer-grant.js.
      { label: 'Email Designer', slug: 'email-designer', hideFromNav: true },
      // Form Builder moved to DATA on 2026-08-30.
      { label: 'Shipping Labels', slug: 'shipping-labels' }
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
      // 'Sent Emails' is no longer a leaf here (2026-08-21): the email
      // HISTORY is now reached from a 'Sent Emails' button in the
      // Campaigns screen's own grid header, hosted in-page by that screen
      // the same way campaign detail and the wizard already are. It is a
      // read-only historical account (preview only - the copy-into-designer
      // jump moved to the designer's own 'Past Emails' template picker), so
      // it needs no NavLeaf/screenKey of its own: it rides
      // campaigns-manager.campaigns' view grant, matching the Composer
      // treatment described at the top of this group.
      // Every email flagged publishToWeb across ALL campaigns = what the
      // public Monthly Newsletter page shows (2026-08-20). The flag is per
      // email and the published issues span several campaigns, so this is
      // the one place that answers "what's on the website?" - set the flag
      // from a campaign's detail page or the Subscriber Report send dialog.
      { label: 'Website Newsletters', slug: 'website-newsletters' },
      // Customer tag rules ("purchased X => tag 'Impact 1'") live here
      // rather than Tools because they exist to feed campaign audiences -
      // they're campaign infrastructure, and keeping them in this group
      // keeps the "can work campaigns" permission story one grant.
      { label: 'Tag Rules', slug: 'tag-rules' }
      // 'Mailchimp' (audience-sync settings) retired 2026-08-20 with the
      // sync itself - Phase 7 of Campaign Manager v2. The app's own send
      // engine + `customers` subscriber flags are the audience now; the
      // Mailchimp audience was reconciled into `customers` first
      // (MIGRATION.md).
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
      { label: 'Events', slug: 'events' },
      // Reader-app patrons (`libraryUsers`), not this app's own staff
      // `admin_users` - a report over the same population the Library
      // Manager's Library Users roster lists, joined to Impact Groups.
      { label: 'Digital Book Users', slug: 'digital-book-users' }
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
      { label: 'Admin Users', slug: 'admin-users', employeeGrantable: false, hideFromNav: true },
      // ROOT-only, unlike the two above which are Admin-or-Root. Not a
      // permission an Admin can be granted: the gate is the role itself,
      // checked in MainScreenComponent.canViewE2eDashboard and again in the
      // tab shell, so a direct ?tab= URL does not get in either.
      { label: 'E2E Dashboard', slug: 'e2e-dashboard', employeeGrantable: false, hideFromNav: true }
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
    // The LIBRARY tab, and the only group on it - so the section FLATTENS
    // (see NavSectionDef.flatten) and these screens render directly under
    // the tab with no 'LIBRARY' header repeating the tab's own name.
    //
    // This tab is also the whole of what a Role.EDITOR can see, since
    // PermissionService hard-scopes that role to library-manager keys. For
    // them the other two tabs have nothing in them, the tab strip hides
    // itself entirely (see MainScreenComponent.showSectionTabs), and this
    // flat list is simply their nav.
    section: 'library',
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

/**
 * Groups whose leaves come from FIRESTORE rather than from this file.
 *
 * Page Manager is the only one, and has been since Web Config moved to Data
 * on 2026-08-31: every leaf under it is a page streamed from `page_content`
 * by SitePagesNavService and merged in at render time.
 */
export const NAV_GROUPS_FILLED_FROM_DATA: readonly string[] = ['page-manager'];

/**
 * Whether a group survives to be drawn, judged on its own items.
 *
 * A group with `items` defined but every one filtered out - Admin Manager
 * today, whose two screens are both hideFromNav - opens onto nothing, so it
 * is dropped rather than rendered as an empty expandable header. A group with
 * NO `items` key at all is a flat link and always passes.
 *
 * EXTRACTED FROM MainScreenComponent so it can be tested. It was an inline
 * predicate in a subscribe, which is why the day Page Manager's last static
 * leaf left, nothing could check that the group still appeared - it would
 * have been judged empty and dropped, taking every page in the nav with it.
 * A rule that decides whether a whole area of the app is reachable should be
 * something a spec can call.
 */
export function keepsNavGroup(group: Pick<NavGroup, 'id' | 'items'>): boolean {
  if (NAV_GROUPS_FILLED_FROM_DATA.includes(group.id)) {
    return true;
  }
  return !group.items || group.items.length > 0;
}
