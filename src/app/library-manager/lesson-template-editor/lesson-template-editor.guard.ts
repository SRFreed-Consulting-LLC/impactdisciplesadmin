import { CanDeactivateFn } from '@angular/router';
import { libraryUnsavedChangesGuard } from 'src/app/common/guards/library-unsaved-changes.guard';
import type { LessonTemplateEditorComponent } from './lesson-template-editor.component';

export const lessonTemplateEditorCanDeactivateGuard: CanDeactivateFn<LessonTemplateEditorComponent> =
  libraryUnsavedChangesGuard('lesson template', 'Could not save the lesson template. Please try again.');
