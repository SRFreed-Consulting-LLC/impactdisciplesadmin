import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SharedModule } from 'src/app/shared/shared.module';
import { EmailBuilderModule } from 'src/app/tools-manager/email-designer/email-builder.module';
import { CampaignEmailEditorRoutingModule } from './campaign-email-editor-routing.module';
import { CampaignEmailEditorComponent } from './campaign-email-editor.component';
import { SaveAsTemplateDialogComponent } from './save-as-template-dialog.component';

// The campaign email editor's own lazy chunk - design + schedule on one
// screen. Imports EmailBuilderModule for the canvas/side panel/dialogs
// (shared with Tools Manager > System Templates' designer) and SharedModule
// for app-date-time-field and app-indicator-button, which the Schedule
// slide-over reuses from the touch editor it replaces.
@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CampaignEmailEditorRoutingModule,
    EmailBuilderModule,
    SharedModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
    MatToolbarModule,
    MatTooltipModule
  ],
  declarations: [CampaignEmailEditorComponent, SaveAsTemplateDialogComponent]
})
export class CampaignEmailEditorModule {}
