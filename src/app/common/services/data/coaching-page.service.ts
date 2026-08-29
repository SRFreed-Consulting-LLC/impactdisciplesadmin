import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CoachingPageModel } from '@impact-common/shared/models/domain/coaching-page.model';
import { stripUndefinedDeep } from 'src/app/common/utils/strip-undefined';
import { BaseService } from './base.service';

/** The one document id the Coaching with Impact page's content lives under.
 *  There is a single such page, so this is a fixed-id settings record rather
 *  than a collection anyone adds rows to - the admin screen always reads and
 *  writes this id, and the web app reads exactly this id. Keep in step with
 *  the web repo's own CoachingPageService. */
export const COACHING_PAGE_DOC_ID = 'current';

/**
 * Reads and writes the public Coaching with Impact page's editable content -
 * its video, which testimonials it shows and in what order, and the
 * "A movement of multiplication" screenshots. See CoachingPageModel.
 *
 * Same shape as DockBarService, and for the same reason: a singleton
 * document, not a list. The document may legitimately not exist yet (nobody
 * has saved the screen), which is not an error - get() resolves undefined and
 * the public page falls back to what it shipped with.
 */
@Injectable({
  providedIn: 'root'
})
export class CoachingPageService extends BaseService<CoachingPageModel> {
  constructor(public override dao: FirebaseDAO<CoachingPageModel>) {
    super(dao);
    this.table = 'coaching_page';
  }

  /** Undefined until the screen has been saved for the first time. */
  get(): Promise<CoachingPageModel | undefined> {
    return this.getById(COACHING_PAGE_DOC_ID);
  }

  /** Always writes the same document id, so saving repeatedly updates the one
   *  page rather than accumulating rows. BaseService.update() is a whole-doc
   *  setDoc, which CREATES the document when it is missing - which is what
   *  makes the very first save from a fresh screen work.
   *
   *  `id` is stripped so it is not written back as a stray field duplicating
   *  the document's own path, and every `undefined` is scrubbed because
   *  Firestore rejects an explicit undefined and fails the ENTIRE write (see
   *  CLAUDE.md's write gotcha) - a live risk here, where videoUrl, videoId
   *  and each screenshot's image are all optional. */
  async save(config: CoachingPageModel): Promise<void> {
    // Destructured off deliberately: this is how `id` is kept OUT of the
    // payload, so the binding being unused is the point, not an oversight.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _ignored, ...payload } = config;
    await this.update(COACHING_PAGE_DOC_ID, stripUndefinedDeep(payload) as CoachingPageModel);
  }
}
