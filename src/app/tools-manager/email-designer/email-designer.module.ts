import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
// The app has no global HttpClient provider (everything else talks to
// Firestore through @angular/fire) - the designer needs it only for Vimeo's
// oEmbed thumbnail lookup, so it's provided here in the lazy chunk.
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuillModule } from 'ngx-quill';
import { ImageUploaderModule } from 'src/app/shared/image-uploader/image-uploader.module';
import { EmailDesignerRoutingModule } from './email-designer-routing.module';
import { EmailDesignerComponent } from './email-designer.component';
import { DesignCanvasComponent } from './canvas/design-canvas.component';
import { BlockHostComponent } from './canvas/block-host.component';
import { InlineTextEditorComponent } from './inline-editor/inline-text-editor.component';
import { DesignerSidePanelComponent } from './side-panel/designer-side-panel.component';
import { SocialBlockSettingsComponent } from './side-panel/block-settings/social-block-settings.component';
import { FooterBlockSettingsComponent } from './side-panel/block-settings/footer-block-settings.component';
import { BlockStyleEditorComponent } from './side-panel/block-style-editor.component';
import { GlobalStylesPanelComponent } from './side-panel/global-styles-panel.component';
import { PreviewDialogComponent } from './preview/preview-dialog.component';
import { SendTestDialogComponent } from './preview/send-test-dialog.component';
import { TemplatePickerDialogComponent } from './template-picker/template-picker-dialog.component';

// The Mailchimp-style email builder - its own lazy chunk under
// /tools-manager/email-designer so the (large) editor never weighs down the
// tools-manager tab shell. See CLAUDE.md / the email-designer folder for
// architecture notes.
@NgModule({
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    DragDropModule,
    EmailDesignerRoutingModule,
    ImageUploaderModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatToolbarModule,
    MatTooltipModule,
    QuillModule
  ],
  declarations: [
    EmailDesignerComponent,
    DesignCanvasComponent,
    BlockHostComponent,
    InlineTextEditorComponent,
    DesignerSidePanelComponent,
    SocialBlockSettingsComponent,
    FooterBlockSettingsComponent,
    BlockStyleEditorComponent,
    GlobalStylesPanelComponent,
    PreviewDialogComponent,
    SendTestDialogComponent,
    TemplatePickerDialogComponent
  ]
})
export class EmailDesignerModule {}
