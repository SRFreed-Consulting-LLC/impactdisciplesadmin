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
import { MatIconModule } from '@angular/material/icon';
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
import { BlockStyleEditorComponent } from './side-panel/block-style-editor.component';
import { GlobalStylesPanelComponent } from './side-panel/global-styles-panel.component';

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
    MatIconModule,
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
    BlockStyleEditorComponent,
    GlobalStylesPanelComponent
  ]
})
export class EmailDesignerModule {}
