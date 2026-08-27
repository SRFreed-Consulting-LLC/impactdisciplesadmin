import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
// The toolbar's own subject-line variable menu. EmailBuilderModule imports
// MatMenuModule for the inline editor's menu, but does not re-export it -
// this shell's template needs its own.
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EmailDesignerRoutingModule } from './email-designer-routing.module';
import { EmailBuilderModule } from './email-builder.module';
import { EmailDesignerComponent } from './email-designer.component';

// The SYSTEM-template shell around the email builder - its own lazy chunk
// under /tools-manager/email-designer so the (large) editor never weighs
// down the tools-manager tab shell. See CLAUDE.md / the email-designer
// folder for architecture notes.
//
// Everything that actually draws the editor moved to EmailBuilderModule on
// 2026-08-21 so the campaign email editor could host the same builder; this
// module is now just the routed shell plus what its own toolbar template
// needs.
@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    EmailDesignerRoutingModule,
    EmailBuilderModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
    MatTooltipModule
  ],
  declarations: [EmailDesignerComponent]
})
export class EmailDesignerModule {}
