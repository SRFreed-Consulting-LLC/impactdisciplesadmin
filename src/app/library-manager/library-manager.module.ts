import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { SharedModule } from '../shared/shared.module';
import { LibraryManagerComponent } from './library-manager.component';
import { LibraryManagerRoutingModule } from './library-manager-routing.module';
import { LibraryBrowseComponent } from './browse/library-browse.component';
import { SubtemplatesListComponent } from './subtemplates/subtemplates-list.component';
import { LessonTemplatesListComponent } from './lesson-templates/lesson-templates-list.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

// Library Manager - the former impact-discipleship-library-manager-new
// app's CMS, being folded in as its own manager module (see that app's
// consolidation plan, Phase 2). Slice 1: module/routing/shell + read-only
// Browse. Slice 2 (in progress): Lesson Editor/Preview, Subtemplates, Lesson
// Templates - Translations/AI Book Import still queued.
//
// Every screen this module gains stays a standalone component as originally
// authored - imported here rather than declared, per the plan's "NgModule
// shell, standalone screens inside" decision. Angular allows importing a
// standalone component directly into an NgModule's `imports` array; only
// this shell component itself needs to be a real NgModule declaration,
// matching every other manager in the app. Full-page editors (Lesson
// Editor/Preview, Subtemplate Editor) are routed separately via
// loadComponent (see library-manager-routing.module.ts) and don't need to
// be imported here at all - only screens reached via a template selector
// (tab-shell NavLeaf screens) do.
@NgModule({
  imports: [
    CommonModule,
    LibraryManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    LibraryBrowseComponent,
    SubtemplatesListComponent,
    LessonTemplatesListComponent
  ],
  declarations: [
    LibraryManagerComponent
  ]
})
export class LibraryManagerModule { }
