import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SharedModule } from '../shared.module';
import { ImageUploaderComponent } from './image-uploader.component';
import { FileTreeNodeComponent } from './file-tree-node.component';
import { NewFolderDialogComponent } from './new-folder-dialog.component';
import { RenameDialogComponent } from './rename-dialog.component';
import { FolderPickerDialogComponent } from './folder-picker-dialog.component';

// This app's own replacement for impactdisciplescommon's DevExtreme-backed
// ImageUploaderModule - see file-browser-storage.service.ts and
// image-uploader.component.ts for the full rationale. A small standalone
// module (not merged into the app-wide SharedModule) matching the
// original's own shape, imported only where the picker is actually used
// (currently just content-manager.module.ts).
@NgModule({
  declarations: [
    ImageUploaderComponent,
    FileTreeNodeComponent,
    NewFolderDialogComponent,
    RenameDialogComponent,
    FolderPickerDialogComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    SharedModule
  ],
  exports: [ImageUploaderComponent]
})
export class ImageUploaderModule {}
