import { EDITABLE_PAGES, kindFor, pageFor, pluralise } from './page-section-catalogue';
import { NAV_CONFIG } from '../../core/main-screen/nav-config';
import SEED from '../../../../scripts/page-content-seed-data.json';

// The catalogue is now the single thing standing between staff and eleven
// public pages: it drives the nav entries, each page's Add menu, which fields
// the editor shows, and how the preview draws every band. Nothing about it is
// type-checked against the two files it has to agree with - nav-config.ts and
// the seed - so these are the checks that would otherwise be a screen
// rendering nothing and nobody knowing why.
//
// Hand-run against the real exported constants, no TestBed: there is no DI
// here, just data.
describe('page section catalogue', () => {
  const pageManager = NAV_CONFIG.find((g) => g.id === 'page-manager');
  const navLabels = new Set((pageManager?.items ?? []).map((i) => i.label));

  it('gives every page a nav leaf with the SAME label', () => {
    // TabShellComponent selects by label, not by slug. A label that drifts
    // here leaves a nav entry that renders an empty panel - no error, no
    // clue, just a blank screen.
    const missing = EDITABLE_PAGES
      .filter((page) => !navLabels.has(page.label))
      .map((page) => page.label);

    expect(missing).toEqual([]);
  });

  it('has a seeded document for every page, keyed by slug', () => {
    // These documents are the ONLY copy of each page's words. A page in the
    // catalogue with nothing seeded is a public page that renders empty.
    const missing = EDITABLE_PAGES
      .filter((page) => !(page.slug in (SEED as Record<string, unknown>)))
      .map((page) => page.slug);

    expect(missing).toEqual([]);
  });

  it('offers a kind for every section type the seed actually uses', () => {
    // The other direction, and the one that bites: a seeded section whose
    // type the page does not offer renders as "Unknown section" in the admin
    // and as NOTHING on the site.
    const orphans: string[] = [];
    for (const page of EDITABLE_PAGES) {
      const blocks = (SEED as Record<string, { type?: string; key: string }[]>)[page.slug] ?? [];
      for (const block of blocks) {
        if (!kindFor(page, block.type)) {
          orphans.push(`${page.slug}/${block.key}: ${block.type}`);
        }
      }
    }

    expect(orphans).toEqual([]);
  });

  it('never seeds two of a singleton section on one page', () => {
    const doubled: string[] = [];
    for (const page of EDITABLE_PAGES) {
      const blocks = (SEED as Record<string, { type?: string }[]>)[page.slug] ?? [];
      const counts = new Map<string, number>();
      for (const block of blocks) {
        counts.set(block.type ?? '', (counts.get(block.type ?? '') ?? 0) + 1);
      }
      for (const kind of page.kinds) {
        if (kind.singleton && (counts.get(kind.type) ?? 0) > 1) {
          doubled.push(`${page.slug}: ${kind.type}`);
        }
      }
    }

    expect(doubled).toEqual([]);
  });

  it('gives every seeded block a unique key within its page', () => {
    // Keys are identity: the stack tracks rows by key and matches a saved
    // dialog back to its row by key. Two rows sharing one would behave as
    // one, and editing either would overwrite the first.
    const clashes: string[] = [];
    for (const page of EDITABLE_PAGES) {
      const blocks = (SEED as Record<string, { key: string }[]>)[page.slug] ?? [];
      const keys = blocks.map((b) => b.key);
      if (new Set(keys).size !== keys.length) {
        clashes.push(page.slug);
      }
    }

    expect(clashes).toEqual([]);
  });

  it('declares an entry editor exactly where a type has a list', () => {
    // A type with `entries` and no `entry` spec opens a dialog with an Add
    // button and no fields; a type with an `entry` spec and no `entries`
    // never shows it. Both are silent.
    const mismatched: string[] = [];
    for (const page of EDITABLE_PAGES) {
      for (const kind of page.kinds) {
        if (!!kind.fields.entries !== !!kind.entry) {
          mismatched.push(`${page.slug}/${kind.type}`);
        }
      }
    }

    expect(mismatched).toEqual([]);
  });

  it('does not offer the same type twice on one page', () => {
    // kindFor() takes the first match, so a duplicate would make the second
    // one unreachable - including its labels and its entry spec.
    const dupes: string[] = [];
    for (const page of EDITABLE_PAGES) {
      const types = page.kinds.map((k) => k.type);
      if (new Set(types).size !== types.length) {
        dupes.push(page.slug);
      }
    }

    expect(dupes).toEqual([]);
  });

  it('finds a page by slug and returns nothing for one it does not have', () => {
    expect(pageFor('seminars')?.label).toBe('Seminars');
    expect(pageFor('podcasts')).toBeUndefined();
  });

});

describe('pluralise', () => {
  it('counts a list in its own words', () => {
    expect(pluralise('course', 3)).toBe('courses');
    expect(pluralise('tile', 2)).toBe('tiles');
    expect(pluralise('passage', 7)).toBe('passages');
  });

  it('leaves one alone', () => {
    expect(pluralise('entry', 1)).toBe('entry');
    expect(pluralise('course', 1)).toBe('course');
  });

  it('spells a consonant-y plural properly', () => {
    // The reason this function exists: the About Us timeline read
    // "4 entrys" on screen.
    expect(pluralise('entry', 4)).toBe('entries');
  });

  it('leaves a vowel-y alone', () => {
    expect(pluralise('day', 2)).toBe('days');
  });
});
