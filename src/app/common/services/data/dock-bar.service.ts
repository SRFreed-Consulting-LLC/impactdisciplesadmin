import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { DockBarModel } from '@impact-common/shared/models/domain/dock-bar.model';
import { stripUndefinedDeep } from 'src/app/common/utils/strip-undefined';
import { BaseService } from './base.service';

/** The one document id the docking bar lives under. There is a single bar on
 *  the public site, so this is a fixed-id settings record rather than a
 *  collection anyone adds rows to - the admin screen always reads and writes
 *  this id, and the web app reads exactly this id. Keep in step with the web
 *  repo's own DockBarService. */
export const DOCK_BAR_DOC_ID = 'current';

/**
 * Reads and writes the public site's docking-bar content (see the web app's
 * LibraryDockComponent, and DockBarModel for the shape).
 *
 * A singleton document, not a list - hence get()/save() rather than the
 * collection-shaped surface BaseService gives most screens. The document may
 * legitimately not exist yet (nobody has saved the screen), which is not an
 * error: get() resolves undefined and the public site simply shows no bar.
 */
@Injectable({
  providedIn: 'root'
})
export class DockBarService extends BaseService<DockBarModel> {
  constructor(public override dao: FirebaseDAO<DockBarModel>) {
    super(dao);
    this.table = 'dock_bar';
  }

  /** Undefined until the screen has been saved for the first time - the DAO's
   *  getById resolves undefined for a document that isn't there. */
  get(): Promise<DockBarModel | undefined> {
    return this.getById(DOCK_BAR_DOC_ID);
  }

  /** Always writes the same document id, so saving repeatedly updates the one
   *  bar rather than accumulating rows. BaseService.update() is a whole-doc
   *  setDoc, which CREATES the document when it is missing - which is what
   *  makes the very first save from a fresh screen work.
   *
   *  Two things are scrubbed on the way in: `id`, which would otherwise be
   *  written into the document as a stray field duplicating its own path, and
   *  any `undefined` value, which Firestore rejects outright and would fail
   *  the ENTIRE write (see CLAUDE.md's write gotcha) - very much a live risk
   *  here, since label, note and the whole of cta2 are all optional. */
  async save(config: DockBarModel): Promise<void> {
    const { id: _ignored, ...payload } = config;
    await this.update(DOCK_BAR_DOC_ID, stripUndefinedDeep(payload) as DockBarModel);
  }
}
