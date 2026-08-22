import { NAV_CONFIG, NavGroup, NavLeaf } from './nav-config';

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
      // Every hidden leaf today is reached from the user menu instead. This
      // catches a screen accidentally orphaned by a hideFromNav flag.
      const hidden = leaves.filter(({ leaf }) => leaf.hideFromNav);
      expect(hidden.length).toBeGreaterThan(0);
      for (const { group } of hidden) {
        expect(group.id).toBe('admin-manager');
      }
    });
  });

  describe('load-bearing slugs', () => {
    // NewRecordAlertsComponent navigates using these exact strings - see
    // NavLeaf.slug's comment. Renaming one silently breaks that deep link.
    it('keeps the slugs other components navigate to', () => {
      const contacts = groups.find((g) => g.id === 'contacts-manager');
      const slugs = (contacts?.items ?? []).map((l) => l.slug);
      expect(slugs).toContain('purchases');
      expect(slugs).toContain('custom-form-submissions');
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

  describe('shape', () => {
    it('has Home as a flat link with no sub-items', () => {
      const home = groups.find((g) => g.id === 'home');
      expect(home).toBeDefined();
      expect(home?.items).toBeUndefined();
    });

    it('gives every other group at least one item, so no group renders empty', () => {
      for (const group of groups.filter((g) => g.id !== 'home')) {
        expect(group.items?.length)
          .withContext(`${group.id} would render as an empty expandable header`)
          .toBeGreaterThan(0);
      }
    });
  });
});
