import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
// The app has no global HttpClient provider (everything else talks to
// Firestore through @angular/fire) - the builder needs it only for Vimeo's
// oEmbed thumbnail lookup in the video block's settings, so it's provided
// here, inside whichever lazy chunk pulls the builder in.
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuillModule } from 'ngx-quill';
import { ImageUploaderModule } from 'src/app/shared/image-uploader/image-uploader.module';
import { DesignCanvasComponent } from './canvas/design-canvas.component';
import { BlockHostComponent } from './canvas/block-host.component';
import { InlineTextEditorComponent } from './inline-editor/inline-text-editor.component';
import { DesignerSidePanelComponent } from './side-panel/designer-side-panel.component';
import { SocialBlockSettingsComponent } from './side-panel/block-settings/social-block-settings.component';
import { FooterBlockSettingsComponent } from './side-panel/block-settings/footer-block-settings.component';
import { TextBlockSettingsComponent } from './side-panel/block-settings/text-block-settings.component';
import { HtmlBlockSettingsComponent } from './side-panel/block-settings/html-block-settings.component';
import { ImageBlockSettingsComponent } from './side-panel/block-settings/image-block-settings.component';
import { ButtonBlockSettingsComponent } from './side-panel/block-settings/button-block-settings.component';
import { SpacerBlockSettingsComponent } from './side-panel/block-settings/spacer-block-settings.component';
import { DividerBlockSettingsComponent } from './side-panel/block-settings/divider-block-settings.component';
import { VideoBlockSettingsComponent } from './side-panel/block-settings/video-block-settings.component';
import { BlockStyleEditorComponent } from './side-panel/block-style-editor.component';
import { GlobalStylesPanelComponent } from './side-panel/global-styles-panel.component';
import { PreviewDialogComponent } from './preview/preview-dialog.component';
import { SendTestDialogComponent } from './preview/send-test-dialog.component';
import { TemplatePickerDialogComponent } from './template-picker/template-picker-dialog.component';

// The email builder's INTERNALS - canvas, side panel, inline editor, and
// its three dialogs - packaged so more than one shell can host them
// (2026-08-21).
//
// Extracted from EmailDesignerModule, which declared all of this and
// exported none of it, so nothing outside that lazy chunk could reuse the
// builder. Two shells host it now: EmailDesignerComponent (Tools Manager >
// System Templates) and CampaignEmailEditorComponent (a campaign's own
// email, where designing and scheduling happen on one screen).
//
// The files deliberately stay under tools-manager/email-designer/ rather
// than moving to shared/ - relocating ~30 files would churn every import in
// the builder for a cosmetic gain. Treat this folder as shared code even
// though it lives under a feature path.
//
// DesignerStateService is NOT provided here on purpose: each shell puts it
// in its own `providers` array so every editor instance gets a fresh
// undo/redo history and design, rather than sharing one across the app.
@NgModule({
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    DragDropModule,
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
    MatTooltipModule,
    QuillModule
  ],
  declarations: [
    DesignCanvasComponent,
    BlockHostComponent,
    InlineTextEditorComponent,
    DesignerSidePanelComponent,
    SocialBlockSettingsComponent,
    FooterBlockSettingsComponent,
    TextBlockSettingsComponent,
    HtmlBlockSettingsComponent,
    ImageBlockSettingsComponent,
    ButtonBlockSettingsComponent,
    SpacerBlockSettingsComponent,
    DividerBlockSettingsComponent,
    VideoBlockSettingsComponent,
    BlockStyleEditorComponent,
    GlobalStylesPanelComponent,
    PreviewDialogComponent,
    SendTestDialogComponent,
    TemplatePickerDialogComponent
  ],
  exports: [
    // The two a shell places in its own template. The dialogs are opened
    // through MatDialog, so declaring them here is enough - they need no
    // export.
    DesignCanvasComponent,
    DesignerSidePanelComponent
  ]
})
export class EmailBuilderModule {}
