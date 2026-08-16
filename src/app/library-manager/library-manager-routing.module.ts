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
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LibraryManagerRoutingModule { }
