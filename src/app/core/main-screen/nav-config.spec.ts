import {
  NAV_CONFIG, NAV_SECTIONS, NavGroup, NavLeaf, keepsNavGroup, sectionOf
} from './nav-config';

// NAV_CONFIG is not just the left nav - it doubles as the granular
// PERMISSION REGISTRY (see its own header comment): a group/leaf/tab's
// id/slug/key form the dot-path "screenKey" that a ScreenPermission grant
// is stored against. That makes its invariants access-control invariants,
// and a duplicate or drifted key is not a cosmetic bug - a stored grant
// keyed to the wrong path either grants nothing or grants the wrong screen.
//
// Nothing else in the repo checks the shape of this tree, and it is edited
// by hand every time a screen moves. These are the rules it has to keep.

const groups: NavGroup[] = NAV_CONFIG;
const leaves: { group: NavGroup; leaf: NavLeaf }[] =
  groups.flatMap((group) => (group.items ?? []).map((leaf) => ({ group, leaf })));

const screenKey = (group: NavGroup, leaf: NavLeaf) => `${group.id}.${leaf.slug}`;

describe('NAV_CONFIG', () => {
  describe('registry integrity', () => {
    it('has a unique id per group - the first segment of every screenKey', () => {
      const ids = groups.map((g) => g.id);
      expect(new Set(ids).size).withContext(`duplicate group ids in ${ids}`).toBe(ids.length);
    });

    it('has a unique screenKey for every leaf', () => {
      // Slugs may repeat ACROSS groups (Reports has its own Purchases and
      // Contacts) - it is the full dot-path that must be unique.
      const keys = leaves.map(({ group, leaf }) => screenKey(group, leaf));
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(dupes).withContext(`duplicate screenKeys: ${dupes}`).toEqual([]);
    });

    it('has a unique slug within each group', () => {
      for (const group of groups) {
        const slugs = (group.items ?? []).map((l) => l.slug);
        expect(new Set(slugs).size)
          .withContext(`duplicate slug inside ${group.id}: ${slugs}`)
          .toBe(slugs.length);
      }
    });

    it('gives every leaf a non-empty label and slug', () => {
      for (const { group, leaf } of leaves) {
        expect(leaf.label?.trim())
          .withContext(`${group.id} has a leaf with no label`).toBeTruthy();
        expect(leaf.slug?.trim())
          .withContext(`${group.id}.${leaf.label} has no slug`).toBeTruthy();
      }
    });

    it('uses url-safe slugs, since they travel as the ?tab= query param', () => {
      for (const { group, leaf } of leaves) {
        expect(leaf.slug)
          .withContext(`${screenKey(group, leaf)} is not url-safe`)
          .toMatch(/^[a-z0-9-]+$/);
      }
    });

    it('gives every group a label, icon and at least one role', () => {
      for (const group of groups) {
        expect(group.label?.trim()).withContext(`${group.id} has no label`).toBeTruthy();
        expect(group.icon?.trim()).withContext(`${group.id} has no icon`).toBeTruthy();
        expect(group.roles?.length).withContext(`${group.id} has no roles`).toBeGreaterThan(0);
      }
    });
  });

  describe('self-escalation lockdown', () => {
    // An Employee who could edit Admin Users could grant themselves
    // anything, so those screens are hard-blocked from the permission
    // system rather than merely hidden. employeeGrantable:false is the
    // load-bearing half - hideFromNav alone is only cosmetic.
    it('keeps Admin Users and Logs out of the grantable permission tree', () => {
      const locked = leaves.filter(({ leaf }) => leaf.employeeGrantable === false);
      expect(locked.map(({ leaf }) => leaf.slug).sort()).toEqual(
        jasmine.arrayContaining(['admin-users', 'logs']));
      for (const { leaf } of locked.filter(({ leaf }) => ['admin-users', 'logs'].includes(leaf.slug))) {
        expect(leaf.hideFromNav)
          .withContext(`${leaf.slug} must also be hidden from the drawer`).toBeTrue();
      }
    });

    it('never marks a screen hideFromNav without a reason to be unreachable', () => {
      // A hidden leaf still needs a grant, so it must be reachable some other
      // way or it is simply orphaned. There are exactly two reasons today:
      //
      //   admin-manager        reached from the user menu
      //   tools-manager.email-designer
      //                        a full-screen editor launched from the screens
      //                        that own each template (an event's Info tab, a
      //                        product's follow-up list, Products' Order
      //                        Receipt, a campaign touch). It has no list of
      //                        its own to land on - System Templates, which
      //                        used to be that, was removed 2026-08-27 - but
      //                        it needs its own key because a direct URL visit
      //                        has no calling screen to borrow permission from.
      //
      // Anything else hidden is a mistake until this list says otherwise.
      const REACHABLE_ELSEWHERE = ['admin-manager', 'tools-manager.email-designer'];
      const hidden = leaves.filter(({ leaf }) => leaf.hideFromNav);
      expect(hidden.length).toBeGreaterThan(0);
      for (const { group, leaf } of hidden) {
        const allowed = REACHABLE_ELSEWHERE.includes(group.id)
          || REACHABLE_ELSEWHERE.includes(`${group.id}.${leaf.slug}`);
        expect(allowed)
          .withContext(`${group.id}.${leaf.slug} is hidden with no way in`)
          .toBeTrue();
      }
    });
  });

  describe('load-bearing slugs', () => {
    // NewRecordAlertsComponent navigates using these exact strings - see
    // NavLeaf.slug's comment. Renaming one silently breaks that deep link.
    it('keeps the slugs other components navigate to', () => {
      const contacts = groups.find((g) => g.id === 'contacts-manager');
      expect((contacts?.items ?? []).map((l) => l.slug)).toContain('purchases');

      // Form Submissions moved to DATA on 2026-08-30 and kept its slug. It
      // was pinned here as "load-bearing - NewRecordAlertsComponent
      // navigates using this exact string", and that had stopped being true:
      // that component deep-links only Event Registrations now and sends
      // everything else to /home. Checked before the move rather than
      // assumed - a stale "do not touch" comment is its own hazard.
      const data = groups.find((g) => g.id === 'data');
      expect((data?.items ?? []).map((l) => l.slug)).toContain('custom-form-submissions');
    });

    it('keeps the campaigns slugs the manager tab shell resolves', () => {
      const campaigns = groups.find((g) => g.id === 'campaigns-manager');
      const slugs = (campaigns?.items ?? []).map((l) => l.slug);
      expect(slugs).toContain('campaigns');
      expect(slugs).toContain('status-board');
      expect(slugs).toContain('tag-rules');
    });

    it('no longer carries a Sent Emails leaf of its own', () => {
      // Restructured 2026-08-21: reached from a button in the Campaigns
      // grid header instead. A leaf reappearing here means the nav and the
      // screen disagree about how it is reached.
      const campaigns = groups.find((g) => g.id === 'campaigns-manager');
      expect((campaigns?.items ?? []).map((l) => l.slug)).not.toContain('sent-emails');
    });
  });

  describe('internal tabs', () => {
    it('only Events declares them, and each has a key and label', () => {
      const withTabs = leaves.filter(({ leaf }) => leaf.tabs?.length);
      expect(withTabs.length).toBeGreaterThan(0);
      for (const { group, leaf } of withTabs) {
        expect(group.id)
          .withContext(`${screenKey(group, leaf)} unexpectedly declares tabs`)
          .toBe('events-manager');
        for (const tab of leaf.tabs ?? []) {
          expect(tab.key?.trim()).withContext(`${leaf.slug} tab with no key`).toBeTruthy();
          expect(tab.label?.trim()).withContext(`${leaf.slug} tab with no label`).toBeTruthy();
        }
      }
    });

    it('keeps tab keys unique within their screen, since they extend the screenKey', () => {
      for (const { group, leaf } of leaves) {
        const keys = (leaf.tabs ?? []).map((t) => t.key);
        expect(new Set(keys).size)
          .withContext(`duplicate tab key in ${screenKey(group, leaf)}: ${keys}`)
          .toBe(keys.length);
      }
    });
  });

  describe('drawer sections', () => {
    // The Admin/Site/Library tabs, added 2026-08-29. Unlike a group move,
    // this rank changes no screenKey - but it can still strand a screen
    // somewhere nobody looks, and every failure mode here is silent.
    const declared = NAV_SECTIONS.map((s) => s.id);

    it('puts every group on a section that exists', () => {
      // A typo'd section id would not fail to compile if it ever widened to
      // a string, and the group would simply stop appearing on every tab.
      for (const group of groups) {
        expect(declared)
          .withContext(`${group.id} is on an undeclared section`)
          .toContain(sectionOf(group));
      }
    });

    it('ships no empty tab', () => {
      // A declared section with nothing on it renders as a segment that
      // switches to a blank nav. visibleSections hides it at runtime, so
      // this is the check that notices it was left declared.
      for (const section of NAV_SECTIONS) {
        expect(groups.some((g) => sectionOf(g) === section.id))
          .withContext(`the ${section.id} tab has no groups on it`)
          .toBeTrue();
      }
    });

    it('only flattens a section holding exactly one group', () => {
      // Flattening drops the group headers. With two groups on the section
      // their screens merge into one undifferentiated list with nothing
      // naming either half - and it looks deliberate.
      for (const section of NAV_SECTIONS.filter((s) => s.flatten)) {
        const held = groups.filter((g) => sectionOf(g) === section.id);
        expect(held.length)
          .withContext(`${section.id} flattens but holds ${held.map((g) => g.id)}`)
          .toBe(1);
      }
    });

    it('gives every section a label to put on its tab', () => {
      for (const section of NAV_SECTIONS) {
        expect(section.label?.trim())
          .withContext(`the ${section.id} section has no label`).toBeTruthy();
      }
    });

    it('keeps Library on its own section, since Editors can see nothing else', () => {
      // PermissionService hard-scopes Role.EDITOR to library-manager keys.
      // Were Library to share a tab with anything else, an Editor would get
      // a tab whose other groups all filter out from under them.
      const librarySection = sectionOf(groups.find((g) => g.id === 'library-manager')!);
      const sharing = groups.filter((g) => sectionOf(g) === librarySection).map((g) => g.id);
      expect(sharing).toEqual(['library-manager']);
    });
  });

  describe('shape', () => {
    // A group with NO `items` is a flat link - it navigates instead of
    // expanding. Listed by name rather than counted, because a flat link is
    // outside the granular permission system entirely
    // (buildPermissionTree() skips groups with no items), so one appearing
    // by accident silently makes a screen Admin-only and ungrantable.
    // FOOTER LEFT THIS LIST on 2026-09-01, when the docking bar moved out of
    // Web Config and became its second leaf. That is not a cosmetic change:
    // a flat link is outside the granular permission system entirely, so
    // both the footer editor and the dock became grantable to an Employee
    // for the first time. No stored grant was affected - nothing in dev or
    // prod held one mentioning footer, checked before the move.
    const FLAT_LINKS = ['home', 'navigation'];

    it('has exactly these flat links, and they really have no sub-items', () => {
      const flat = groups.filter((g) => !g.items).map((g) => g.id);
      expect(flat).toEqual(FLAT_LINKS);
    });

    /**
     * PAGE MANAGER declares no static items at all since Web Config moved to
     * Data (2026-08-31). Every leaf it has is a page streamed from
     * `page_content` and merged in at render time, so an empty static list is
     * correct rather than a mistake - and MainScreenComponent carries a
     * matching exception, without which the group would be dropped and every
     * page would vanish from the nav.
     *
     * NAMED rather than inferred, so a SECOND group going empty is still
     * caught. That is the failure this check exists for.
     */
    const FILLED_FROM_DATA = ['page-manager'];

    it('gives every OTHER group at least one item, so none renders empty', () => {
      // An expandable header that opens onto nothing. MainScreenComponent
      // drops such a group at runtime, so this is the check that notices it
      // was left in the registry at all.
      const staticGroups = groups.filter(
        (g) => !FLAT_LINKS.includes(g.id) && !FILLED_FROM_DATA.includes(g.id)
      );
      for (const group of staticGroups) {
        expect(group.items?.length)
          .withContext(`${group.id} would render as an empty expandable header`)
          .toBeGreaterThan(0);
      }
    });

    it('names exactly one group as filled from data', () => {
      // Pinned so a second one cannot be added quietly. Each entry needs a
      // matching exception in MainScreenComponent's own filter, or the group
      // is judged on its empty static list and disappears from the nav -
      // which is what happened to Page Manager the moment Web Config left it.
      // The runtime half is keepsNavGroup(), checked below.
      expect(FILLED_FROM_DATA).toEqual(['page-manager']);
    });

    it('keeps Page Manager even with no static items, and drops a truly empty group', () => {
      // THE RUNTIME RULE, and the reason it was extracted from the drawer:
      // as an inline predicate it decided whether a whole area of the app
      // was reachable and no spec could call it.
      expect(keepsNavGroup({ id: 'page-manager', items: [] }))
        .withContext('Page Manager fills from Firestore - dropping it hides every page')
        .toBeTrue();

      expect(keepsNavGroup({ id: 'admin-manager', items: [] }))
        .withContext('a group that really is empty opens onto nothing')
        .toBeFalse();

      // A flat link has no items key at all and always passes.
      expect(keepsNavGroup({ id: 'home', items: undefined })).toBeTrue();
      expect(keepsNavGroup({ id: 'store-manager', items: [{ label: 'X', slug: 'x' }] })).toBeTrue();
    });

    it('really has no static items left in Page Manager', () => {
      // Not an assumption: if a static leaf is ever added back, the exception
      // above stops being needed and this says so rather than leaving a
      // special case nobody can justify.
      const pageManager = groups.find((g) => g.id === 'page-manager');
      expect(pageManager?.items).toEqual([]);
    });
  });
});
