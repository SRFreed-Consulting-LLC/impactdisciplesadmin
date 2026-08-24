import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '../shared/shared.module';
import { CampaignsManagerRoutingModule } from './campaigns-manager-routing.module';
import { CampaignsManagerComponent } from './campaigns-manager.component';
import { CampaignsComponent } from './campaigns/campaigns.component';
import { CampaignDetailComponent } from './campaign-detail/campaign-detail.component';
import { PublishWebDialogComponent } from './campaign-detail/publish-web-dialog.component';
import { WebNewslettersComponent } from './web-newsletters/web-newsletters.component';
import { CampaignWizardComponent } from './campaign-wizard/campaign-wizard.component';
import { PopupEditorComponent } from './popup-editor/popup-editor.component';
import { PopupLivePreviewComponent } from './popup-editor/popup-live-preview/popup-live-preview.component';
import { SocialComposerComponent } from './social-composer/social-composer.component';
import { StatusBoardComponent } from './status-board/status-board.component';
import { TagRulesComponent } from './tag-rules/tag-rules.component';
import { SentEmailsComponent } from './sent-emails/sent-emails.component';
import { SentEmailPreviewDialogComponent } from './sent-emails/sent-email-preview-dialog.component';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { QuillModule } from 'ngx-quill';

@NgModule({
  declarations: [
    CampaignsManagerComponent,
    CampaignsComponent,
    CampaignDetailComponent,
    PublishWebDialogComponent,
    WebNewslettersComponent,
    CampaignWizardComponent,
    PopupEditorComponent,
    PopupLivePreviewComponent,
    SocialComposerComponent,
    StatusBoardComponent,
    TagRulesComponent,
    SentEmailsComponent,
    SentEmailPreviewDialogComponent
  ],
  imports: [
    CommonModule,
    CampaignsManagerRoutingModule,
    SharedModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatMenuModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatToolbarModule,
    MatTooltipModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    MatRadioModule,
    QuillModule
  ]
})
export class CampaignsManagerModule { }
