import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { doc, getDoc, setDoc } from '@angular/fire/firestore';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { firstValueFrom } from 'rxjs';
import { BASE64_IMAGE_RE, HTML_TYPES } from '@impact-common/formio/form-translation.util';
import { hydrateFormioSchema } from '@impact-common/queries/lesson-image-queries';
import {
  LibraryFormioComponent,
  LibraryFormioSchema,
} from 'src/app/common/models/domain/library/library-lesson.model';
import { libraryFirestore } from './library-firestore.util';
import { libraryHashText } from './library-hash.util';

/**
 * Lesson/subtemplate content images are stored in their own
 * `lessonImages/{id}` document (`id` = a content hash of the image's data
 * URI) instead of embedded inline as base64 - ported from
 * impact-discipleship-library-manager-new's LessonImageService, see its own
 * doc comment for the full rationale. `hydrateSchema`/`dehydrateSchema` deep-
 * clone and never mutate the caller's copy.
 *
 * `getImageDataUri`/`hydrateTranslationResource` deliberately not ported yet
 * - both are Translations-screen-only, arriving with that later slice.
 */
@Injectable({
  providedIn: 'root'
})
export class LibraryLessonImageService {
  constructor(
    private app: FirebaseApp,
    private authService: AdminAuthService
  ) {}

  async uploadImage(dataUri: string): Promise<string> {
    const id = libraryHashText(dataUri);
    const ref = doc(libraryFirestore(this.app), 'lessonImages', id);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      const contentType = /^data:([^;]+);/.exec(dataUri)?.[1] ?? 'application/octet-stream';
      const user = await firstValueFrom(this.authService.dao.loggedInUser$);
      await setDoc(ref, {
        dataUri,
        contentType,
        createdAt: Date.now(),
        createdBy: user?.firebaseUID ?? user?.id ?? ''
      });
    }
    return id;
  }

  hydrateSchema(schema: LibraryFormioSchema | null): Promise<LibraryFormioSchema | null> {
    return hydrateFormioSchema(libraryFirestore(this.app), schema);
  }

  async dehydrateSchema(schema: LibraryFormioSchema): Promise<LibraryFormioSchema> {
    const clone: LibraryFormioSchema = JSON.parse(JSON.stringify(schema));
    const htmlComponents = collectHtmlComponents(clone.components);

    for (const component of htmlComponents) {
      const html = component['html'];
      if (typeof html !== 'string') {
        continue;
      }
      const dataUris = [...html.matchAll(BASE64_IMAGE_RE)].map((match) => match[1]);
      if (dataUris.length === 0) {
        continue;
      }
      const idByDataUri = new Map<string, string>();
      for (const dataUri of new Set(dataUris)) {
        idByDataUri.set(dataUri, await this.uploadImage(dataUri));
      }
      component['html'] = html.replace(BASE64_IMAGE_RE, (tag, dataUri) =>
        tag.replace(dataUri, `lessonimage:${idByDataUri.get(dataUri)}`)
      );
    }
    return clone;
  }
}

function collectHtmlComponents(
  components: LibraryFormioComponent[] | undefined
): LibraryFormioComponent[] {
  const out: LibraryFormioComponent[] = [];
  for (const component of components ?? []) {
    if (HTML_TYPES.has(component.type)) {
      out.push(component);
    }
    out.push(
      ...collectHtmlComponents(component['components'] as LibraryFormioComponent[] | undefined)
    );
    const columns = component['columns'] as { components: LibraryFormioComponent[] }[] | undefined;
    for (const column of columns ?? []) {
      out.push(...collectHtmlComponents(column.components));
    }
    const rows = component['rows'];
    if (Array.isArray(rows)) {
      for (const row of rows as LibraryFormioComponent[][]) {
        out.push(...collectHtmlComponents(row));
      }
    }
  }
  return out;
}
