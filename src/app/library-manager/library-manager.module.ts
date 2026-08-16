import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { SharedModule } from '../shared/shared.module';
import { LibraryManagerComponent } from './library-manager.component';
import { LibraryManagerRoutingModule } from './library-manager-routing.module';
import { LibraryBrowseComponent } from './browse/library-browse.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

// Library Manager - the former impact-discipleship-library-manager-new
// app's CMS, being folded in as its own manager module (see that app's
// consolidation plan, Phase 2). Slice 1 (scaffolding) only: the module/
// routing/shell + a read-only Browse screen, proving the pattern before
// later slices add the real authoring screens.
//
// LibraryBrowseComponent (and every screen this module gains later) stays a
// standalone component as originally authored - imported here rather than
// declared, per the plan's "NgModule shell, standalone screens inside"
// decision. Angular allows importing a standalone component directly into
// an NgModule's `imports` array; only this shell component itself needs to
// be a real NgModule declaration, matching every other manager in the app.
@NgModule({
  imports: [
    CommonModule,
    LibraryManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    LibraryBrowseComponent
  ],
  declarations: [
    LibraryManagerComponent
  ]
})
export class LibraryManagerModule { }
