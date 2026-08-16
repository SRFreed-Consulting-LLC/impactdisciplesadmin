import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LibraryManagerComponent } from './library-manager.component';
import { lessonEditorCanDeactivateGuard } from './lesson-editor/lesson-editor.guard';

const routes: Routes = [
  { path: '', component: LibraryManagerComponent },
  // Full-page editor, not one of the tab-shell's own NavLeaf screens (same
  // as impact-discipleship-library-manager-new's own top-level /lessons/:id
  // route) - reached from Browse, resolves to /library-manager/lessons/:id.
  {
    path: 'lessons/:id',
    loadComponent: () =>
      import('./lesson-editor/lesson-editor.component').then((m) => m.LessonEditorComponent),
    canDeactivate: [lessonEditorCanDeactivateGuard],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LibraryManagerRoutingModule { }
