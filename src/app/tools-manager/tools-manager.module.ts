import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { SharedModule } from '../shared/shared.module';
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';
import { ToolsManagerComponent } from './tools-manager.component';
import { ToolsManagerRoutingModule } from './tools-manager-routing.module';
import { ShippingLabelsComponent } from './shipping-labels/shipping-labels.component';
import { ShippingLabelDialogComponent } from './shipping-labels/shipping-label-dialog.component';
import { ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatDividerModule } from '@angular/material/divider';
import { QuillModule } from 'ngx-quill';

// Utility/configuration screens, not customer or content records - moved
// here (from admin-manager, content-manager) so they read as one coherent
// group. See nav-config.ts's 'tools-manager' group for the full reasoning.
@NgModule({
  imports: [
    CommonModule,
    ToolsManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    ImageUploaderModule,
    ReactiveFormsModule,
    DragDropModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSelectModule,
    MatCheckboxModule,
    MatMenuModule,
    MatButtonToggleModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
    MatDividerModule,
    QuillModule
  ],
  declarations: [
    ToolsManagerComponent,
    ShippingLabelsComponent,
    ShippingLabelDialogComponent,
  ]
})
export class ToolsManagerModule { }
