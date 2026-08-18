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
import { StatusBoardComponent } from './status-board/status-board.component';
import { TemplateGalleryComponent } from './composer/template-gallery.component';
import { CampaignComposerComponent } from './composer/campaign-composer.component';
import { TagRulesComponent } from './tag-rules/tag-rules.component';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

@NgModule({
  declarations: [
    CampaignsManagerComponent,
    CampaignsComponent,
    StatusBoardComponent,
    TemplateGalleryComponent,
    CampaignComposerComponent,
    TagRulesComponent
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
    MatSlideToggleModule
  ]
})
export class CampaignsManagerModule { }
