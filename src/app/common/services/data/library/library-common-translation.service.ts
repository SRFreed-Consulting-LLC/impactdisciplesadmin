import { Injectable } from '@angular/core';
import { Firestore, collectionGroup, deleteDoc, doc, getDoc, getDocs, setDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { extractImageSrc, extractTranslatableFields } from '@impact-common/formio/form-translation.util';
import { getCommonTranslations } from '@impact-common/queries/translation-queries';
import { CommonTranslation, TranslationFieldKind } from '@impact-common/models/translation.models';
import { LibraryFormioSchema } from 'src/app/common/models/domain/library/library-lesson.model';
import { libraryHashText } from './library-hash.util';
import { LibraryActivityLogService } from './library-activity-log.service';

export interface LibraryCommonPhraseCandidate {
  originalText: string;
  kind: TranslationFieldKind;
  lessonCount: number;
}

/** Minimum number of lessons a piece of text has to appear in, verbatim, to
 *  surface as a shared/common-translation candidate - see the source
 *  service's own doc comment. */
const MIN_LESSON_COUNT = 2;

const SCAN_BATCH_SIZE = 25;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function commonTranslationId(originalText: string, locale: string): string {
  return `${libraryHashText(originalText)}_${locale}`;
}

// Reads/writes the `commonTranslations` collection in THIS app's own
// default database (Phase 3 migration target) - ported from
// impact-discipleship-library-manager-new's CommonTranslationService,
// converted to a one-shot read (see LibraryTranslationService's own
// comment) - no shareReplay needed since nothing here holds a live
// subscription open across screens the way the source app's does.
//
// findCommonPhrases() is ported in full even though the standalone Common
// Translations *management* screen (with its "find candidates" scanning UI)
// isn't ported yet - only getCommonTranslations() is currently exercised
// (by Lesson Editor/Preview/Translation), but keeping this method here now
// means that screen can be added later without touching this service again.
// It now scans via a `collectionGroup('lessons')` query rather than a flat
// top-level `lessons` collection read, since Phase 3 nested lessons under
// librarySeries/{s}/books/{b}/units/{u} - see LibraryLessonService's own
// comment on this same collectionGroup-scan pattern.
@Injectable({
  providedIn: 'root'
})
export class LibraryCommonTranslationService {
  constructor(
    private firestore: Firestore,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService
  ) {}

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  getCommonTranslations(): Promise<CommonTranslation[]> {
    return firstValueFrom(getCommonTranslations(this.firestore));
  }

  async findCommonPhrases(): Promise<LibraryCommonPhraseCandidate[]> {
    const lessonsSnap = await getDocs(collectionGroup(this.firestore, 'lessons'));
    const countByText = new Map<string, { kind: TranslationFieldKind; count: number }>();

    for (let i = 0; i < lessonsSnap.docs.length; i += SCAN_BATCH_SIZE) {
      const batch = lessonsSnap.docs.slice(i, i + SCAN_BATCH_SIZE);
      for (const lessonDoc of batch) {
        const schema = lessonDoc.data()['formSchema'] as LibraryFormioSchema | null;
        const fields = extractTranslatableFields(schema);
        const seenInThisLesson = new Set<string>();
        for (const field of fields) {
          if (field.kind === 'html' && extractImageSrc(field.originalText) !== null) {
            continue;
          }
          if (seenInThisLesson.has(field.originalText)) {
            continue;
          }
          seenInThisLesson.add(field.originalText);
          const existing = countByText.get(field.originalText);
          if (existing) {
            existing.count++;
          } else {
            countByText.set(field.originalText, { kind: field.kind, count: 1 });
          }
        }
      }
      if (i + SCAN_BATCH_SIZE < lessonsSnap.docs.length) {
        await yieldToEventLoop();
      }
    }

    return [...countByText.entries()]
      .filter(([, v]) => v.count >= MIN_LESSON_COUNT)
      .map(([originalText, v]) => ({ originalText, kind: v.kind, lessonCount: v.count }))
      .sort((a, b) => b.lessonCount - a.lessonCount || a.originalText.localeCompare(b.originalText));
  }

  async saveCommonTranslation(
    originalText: string,
    kind: TranslationFieldKind,
    locale: string,
    localeLabel: string,
    translatedText: string
  ): Promise<void> {
    const ref = doc(this.firestore, 'commonTranslations', commonTranslationId(originalText, locale));
    const existing = await getDoc(ref);
    const now = Date.now();
    const uid = await this.uid();
    await setDoc(ref, {
      originalText,
      kind,
      locale,
      localeLabel,
      translatedText,
      createdAt: existing.exists() ? existing.data()['createdAt'] : now,
      updatedAt: now,
      createdBy: existing.exists() ? existing.data()['createdBy'] : uid,
      updatedBy: uid
    });
    await this.activityLog.log(existing.exists() ? 'translation_updated' : 'translation_created', {
      targetName: originalText.slice(0, 60),
      detail: `Common translation (${localeLabel}): "${translatedText}"`
    });
  }

  async deleteCommonTranslation(originalText: string, locale: string, localeLabel: string): Promise<void> {
    await deleteDoc(doc(this.firestore, 'commonTranslations', commonTranslationId(originalText, locale)));
    await this.activityLog.log('translation_deleted', {
      targetName: originalText.slice(0, 60),
      detail: `Common translation (${localeLabel})`
    });
  }
}
