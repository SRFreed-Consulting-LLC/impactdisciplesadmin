import { CanDeactivateFn } from '@angular/router';
import { libraryUnsavedChangesGuard } from 'src/app/common/guards/library-unsaved-changes.guard';
import type { SubtemplateEditorComponent } from './subtemplate-editor.component';

export const subtemplateEditorCanDeactivateGuard: CanDeactivateFn<SubtemplateEditorComponent> =
  libraryUnsavedChangesGuard('subtemplate', 'Could not save the subtemplate. Please try again.');
