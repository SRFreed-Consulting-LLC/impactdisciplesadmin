import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LibraryManagerComponent } from './library-manager.component';
import { lessonEditorCanDeactivateGuard } from './lesson-editor/lesson-editor.guard';
import { subtemplateEditorCanDeactivateGuard } from './subtemplate-editor/subtemplate-editor.guard';
import { lessonTemplateEditorCanDeactivateGuard } from './lesson-template-editor/lesson-template-editor.guard';

const routes: Routes = [
  { path: '', component: LibraryManagerComponent },
  // Full-page editors, not tab-shell NavLeaf screens (same split the source
  // app itself uses - a top-level route per editor, not a tab).
  {
    path: 'lessons/:id',
    loadComponent: () =>
      import('./lesson-editor/lesson-editor.component').then((m) => m.LessonEditorComponent),
    canDeactivate: [lessonEditorCanDeactivateGuard],
  },
  {
    path: 'lessons/:id/preview',
    loadComponent: () =>
      import('./lesson-preview/lesson-preview.component').then((m) => m.LessonPreviewComponent),
  },
  {
    path: 'lessons/:id/translate',
    loadComponent: () =>
      import('./lesson-translation/lesson-translation.component').then(
        (m) => m.LessonTranslationComponent,
      ),
  },
  {
    path: 'lessons/:id/translate/:translationId',
    loadComponent: () =>
      import('./lesson-translation/lesson-translation.component').then(
        (m) => m.LessonTranslationComponent,
      ),
  },
  {
    path: 'subtemplates/:id',
    loadComponent: () =>
      import('./subtemplate-editor/subtemplate-editor.component').then(
        (m) => m.SubtemplateEditorComponent,
      ),
    canDeactivate: [subtemplateEditorCanDeactivateGuard],
  },
  {
    path: 'lesson-templates/:id',
    loadComponent: () =>
      import('./lesson-template-editor/lesson-template-editor.component').then(
        (m) => m.LessonTemplateEditorComponent,
      ),
    canDeactivate: [lessonTemplateEditorCanDeactivateGuard],
  },
  // Slice 4 part 4: Library Users. 'messages' MUST be registered before
  // ':email' - Angular matches routes in order, so the static segment has
  // to win before the param route would otherwise swallow it as an email.
  {
    path: 'library-users/messages',
    loadComponent: () =>
      import('./library-users/message-history.component').then((m) => m.MessageHistoryComponent),
  },
  {
    path: 'library-users/:email',
    loadComponent: () =>
      import('./library-users/library-user-detail.component').then(
        (m) => m.LibraryUserDetailComponent,
      ),
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LibraryManagerRoutingModule { }
