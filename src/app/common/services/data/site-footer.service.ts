import { Injectable } from '@angular/core';
import { BaseService } from './base.service';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import {
  SITE_FOOTER_COLLECTION,
  SITE_FOOTER_DOC_ID,
  SiteFooter,
  validateSiteFooter
} from '@impact-common/shared/models/domain/site-footer.model';

/**
 * The public site's footer - ONE document, `site_footer/main`.
 *
 * One document for the same reason as the navigation: the footer renders on
 * every page, so a half-applied write is a broken footer site-wide.
 */
@Injectable({ providedIn: 'root' })
export class SiteFooterService extends BaseService<SiteFooter> {
  public override table = SITE_FOOTER_COLLECTION;

  /**
   * Reads the footer once. `null` means the document does not exist - an
   * environment nobody has seeded - which the screen says out loud rather
   * than presenting as an empty footer somebody would then rebuild.
   *
   * A one-time read, not a stream, for the same two reasons as the
   * navigation: this DAO's streamById only fires when the document EXISTS,
   * so an unseeded environment would load forever; and a live stream under a
   * local working copy lets a colleague's save replace an edit mid-flight.
   */
  async load(): Promise<SiteFooter | null> {
    const record = await this.getById(SITE_FOOTER_DOC_ID);
    return record ?? null;
  }

  /**
   * Saves the whole footer, refusing an invalid one with the same shared
   * validator the seed script mirrors - so the two cannot disagree about
   * what a valid footer is.
   */
  save(footer: SiteFooter): Promise<void> {
    const problems = validateSiteFooter(footer);
    if (problems.length) {
      return Promise.reject(new Error(problems.join('\n')));
    }
    // The stored document has no `id` field of its own; the DAO injects one
    // on read. A partial write of the real fields keeps it out of Firestore.
    const { id, ...fields } = footer;
    void id;
    return this.updateFields(SITE_FOOTER_DOC_ID, { ...fields });
  }
}
