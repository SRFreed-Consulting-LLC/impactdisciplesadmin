import { Injectable } from '@angular/core';
import { BaseService } from './base.service';
import {
  SITE_NAVIGATION_COLLECTION,
  SITE_NAVIGATION_DOC_ID,
  SiteNavItem,
  SiteNavigation,
  validateSiteNavigation
} from '@impact-common/shared/models/domain/site-navigation.model';

/**
 * The public site's top menu - ONE document, `site_navigation/main`.
 *
 * One document rather than a collection because a reorder has to be atomic: a
 * half-applied write is a scrambled site header on every page of the public
 * site, which is a worse failure than anything a per-item collection would
 * buy. It is also tiny - eight items and thirteen children.
 */
@Injectable({ providedIn: 'root' })
export class SiteNavigationService extends BaseService<SiteNavigation> {
  public override table = SITE_NAVIGATION_COLLECTION;

  /**
   * Reads the menu once. `null` means the document does not exist - an
   * environment nobody has seeded - which the screen has to say out loud
   * rather than present as an empty menu somebody would then "fix" by
   * rebuilding one that already exists elsewhere.
   *
   * A ONE-TIME READ, not a live stream, and that is deliberate twice over.
   * This DAO's streamById() only fires its callback when the document
   * EXISTS, so an unseeded environment would leave the screen loading
   * forever with nothing to show for it. And a live stream on a screen whose
   * whole working copy is local would let a colleague's save silently
   * replace an arrangement mid-edit.
   */
  async load(): Promise<SiteNavItem[] | null> {
    const record = await this.getById(SITE_NAVIGATION_DOC_ID);
    return record ? (record.items ?? []) : null;
  }

  /**
   * Saves the whole menu.
   *
   * REFUSES to write an invalid one, using the same shared validator the seed
   * script repeats - so the two cannot disagree about what a valid menu is.
   * This is the last gate before a document that every page of the public
   * site reads, and the failure it guards against is silent: a group with no
   * children renders as a dropdown that opens onto nothing, and a page item
   * with no route renders as a link to nowhere.
   */
  save(items: SiteNavItem[]): Promise<void> {
    const problems = validateSiteNavigation(items);
    if (problems.length) {
      return Promise.reject(new Error(problems.join('\n')));
    }
    // updateFields, not update(): a partial write of the one field this
    // document has. update() is a full setDoc here and would carry back
    // whatever else the in-memory copy happened to hold - including the
    // injected `id`, which is not a real field on the document.
    return this.updateFields(SITE_NAVIGATION_DOC_ID, { items });
  }
}
