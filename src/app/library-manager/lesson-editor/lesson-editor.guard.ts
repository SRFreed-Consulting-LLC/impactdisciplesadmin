import { CanDeactivateFn } from '@angular/router';
import { libraryUnsavedChangesGuard } from 'src/app/common/guards/library-unsaved-changes.guard';
// Type-only import - see libraryUnsavedChangesGuard's own note on why.
import type { LessonEditorComponent } from './lesson-editor.component';

export const lessonEditorCanDeactivateGuard: CanDeactivateFn<LessonEditorComponent> =
  libraryUnsavedChangesGuard(
    'lesson',
    'Could not save the lesson. Please try again.',
    // save() is a no-op while a template-merge preview is pending - "Save
    // and Leave" needs to implicitly keep whatever merge is currently being
    // previewed rather than silently dropping it.
    (component) => component.keepMerge(),
  );
