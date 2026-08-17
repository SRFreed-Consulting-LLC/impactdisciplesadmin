import { Injectable } from '@angular/core';
import { Firestore, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, setDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { getTitleTranslationsByNode } from '@impact-common/queries/translation-queries';
import { LibraryNodeType, TitleTranslation } from '@impact-common/models/translation.models';
import { LibraryActivityLogService } from './library-activity-log.service';

function titleTranslationId(nodeType: LibraryNodeType, nodeId: string, locale: string): string {
  return `${nodeType}_${nodeId}_${locale}`;
}

// Reads/writes the `titleTranslations` collection in THIS app's own
// default database (Phase 3 migration target) - ported from
// impact-discipleship-library-manager-new's TitleTranslationService,
// converted to one-shot reads (see LibraryTranslationService's own comment).
@Injectable({
  providedIn: 'root'
})
export class LibraryTitleTranslationService {
  constructor(
    private firestore: Firestore,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService
  ) {}

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  getTitleTranslations(nodeId: string): Promise<TitleTranslation[]> {
    return firstValueFrom(getTitleTranslationsByNode(this.firestore, nodeId));
  }

  /** Every distinct locale used anywhere in the library so far - merged from
   *  both existing title translations and lesson-content translations. See
   *  the source service's own doc comment for why this isn't denormalized
   *  into a small "known locales" doc instead. One-shot here (not
   *  shareReplay'd like the source's live version) - matches this app's own
   *  one-shot convention; re-run per dialog open rather than kept live. */
  async getKnownLocales(): Promise<{ locale: string; localeLabel: string }[]> {
    const fs = this.firestore;
    const [fromTitles, fromContent] = await Promise.all([
      getDocs(collection(fs, 'titleTranslations')),
      getDocs(collectionGroup(fs, 'translations')),
    ]);
    const byLocale = new Map<string, string>();
    for (const snap of [...fromTitles.docs, ...fromContent.docs]) {
      const data = snap.data() as { locale?: string; localeLabel?: string };
      if (data.locale && !byLocale.has(data.locale)) {
        byLocale.set(data.locale, data.localeLabel ?? data.locale);
      }
    }
    return [...byLocale.entries()]
      .map(([locale, localeLabel]) => ({ locale, localeLabel }))
      .sort((a, b) => a.localeLabel.localeCompare(b.localeLabel));
  }

  async saveTitleTranslation(
    nodeType: LibraryNodeType,
    nodeId: string,
    locale: string,
    localeLabel: string,
    title: string,
    nodeTitle: string
  ): Promise<void> {
    const ref = doc(this.firestore, 'titleTranslations', titleTranslationId(nodeType, nodeId, locale));
    const existing = await getDoc(ref);
    const now = Date.now();
    const uid = await this.uid();
    await setDoc(ref, {
      nodeType,
      nodeId,
      locale,
      localeLabel,
      title,
      createdAt: existing.exists() ? existing.data()['createdAt'] : now,
      updatedAt: now,
      createdBy: existing.exists() ? existing.data()['createdBy'] : uid,
      updatedBy: uid
    });
    await this.activityLog.log(existing.exists() ? 'translation_updated' : 'translation_created', {
      targetName: nodeTitle,
      detail: `Title translation (${localeLabel}): "${title}"`
    });
  }

  async deleteTitleTranslation(
    nodeType: LibraryNodeType,
    nodeId: string,
    locale: string,
    localeLabel: string,
    nodeTitle: string
  ): Promise<void> {
    await deleteDoc(doc(this.firestore, 'titleTranslations', titleTranslationId(nodeType, nodeId, locale)));
    await this.activityLog.log('translation_deleted', {
      targetName: nodeTitle,
      detail: `Title translation (${localeLabel})`
    });
  }
}
