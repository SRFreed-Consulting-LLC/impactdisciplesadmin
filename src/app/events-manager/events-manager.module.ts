import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { CoachesComponent } from './coaches/coaches.component';
import { CoachDialogComponent } from './coaches/coach-dialog.component';
import { EventsComponent } from './events/events.component';
import { VenueRoomsDialogComponent } from './events/venue-rooms-dialog.component';
import { SummitHubComponent } from './events/summit-hub/summit-hub.component';
import { SummitCommandCenterComponent } from './events/summit-command-center/summit-command-center.component';
import { SessionAssignmentDialogComponent } from './events/summit-command-center/session-assignment-dialog.component';
import { SummitSetupWizardComponent } from './events/summit-setup-wizard/summit-setup-wizard.component';
import { SummitPreviewComponent } from './events/summit-preview/summit-preview.component';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { EventAttendeesComponent } from './events/event-attendees/event-attendees.component';
import { EventAttendeeDialogComponent } from './events/event-attendees/event-attendee-dialog.component';
import { EventEmailDialogComponent } from './events/event-attendees/event-email-dialog.component';
import { EventAgendaComponent } from './events/event-agenda/event-agenda.component';
import { AgendaItemDialogComponent } from './events/event-agenda/agenda-item-dialog.component';
import { BreakoutBlockDialogComponent } from './events/event-agenda/breakout-block-dialog.component';
import { CoachQuickCreateDialogComponent } from './events/event-agenda/coach-quick-create-dialog.component';
import { AgendaWizardComponent } from './events/event-agenda/agenda-wizard/agenda-wizard.component';
import { AgendaCanvasComponent } from './events/event-agenda/agenda-canvas/agenda-canvas.component';
import { AgendaGridComponent } from './events/event-agenda/agenda-grid/agenda-grid.component';
import { EventsManagerComponent } from './events-manager.component';
import { SharedModule } from '../shared/shared.module';
// Rooms moved under events/ when the standalone Locations screen retired
// (2026-08-19) - they're the Summit venue's rooms now, edited from the
// Summit screen's Venue Rooms panel.
import { RoomComponent } from './events/room/room.component';
import { FAQComponent } from './events/event-application/questions-and-answers/faq.component';
import { FaqDialogComponent } from './events/event-application/questions-and-answers/faq-dialog.component';
import { EventApplicationComponent } from './events/event-application/event-application.component';
// This app's own Material file browser, replacing the DevExtreme
// dx-file-manager-backed app-image-uploader from impactdisciplescommon -
// see src/app/shared/image-uploader/ for the full rationale (built during
// the Web Manager migration, reused throughout Store Manager).
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';
import { EventsManagerRoutingModule } from './events-manager-routing.module';
import { RoomDialogComponent } from './events/room/room-dialog.component';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QuillModule } from 'ngx-quill';

@NgModule({
    declarations: [
      EventsManagerComponent,
      EventsComponent,
      VenueRoomsDialogComponent,
      SummitHubComponent,
      SummitCommandCenterComponent,
      SessionAssignmentDialogComponent,
      SummitSetupWizardComponent,
      SummitPreviewComponent,
      CoachesComponent,
      CoachDialogComponent,
      EventAgendaComponent,
      AgendaItemDialogComponent,
      BreakoutBlockDialogComponent,
      CoachQuickCreateDialogComponent,
      AgendaWizardComponent,
      AgendaCanvasComponent,
      AgendaGridComponent,
      EventAttendeesComponent,
      EventAttendeeDialogComponent,
      EventEmailDialogComponent,
      RoomComponent,
      RoomDialogComponent,
      FAQComponent,
      FaqDialogComponent,
      EventApplicationComponent
    ],
    imports: [
      CommonModule,
      EventsManagerRoutingModule,
      SharedModule,
      FormsModule,
      ImageUploaderModule,
      ImpactDisciplesCommonModule,
      ReactiveFormsModule,
      MatDialogModule,
      MatFormFieldModule,
      MatInputModule,
      MatTableModule,
      MatIconModule,
      MatButtonModule,
      MatTooltipModule,
      MatSelectModule,
      MatTabsModule,
      MatSlideToggleModule,
      MatCheckboxModule,
      MatMenuModule,
      MatToolbarModule,
      MatProgressSpinnerModule,
      MatButtonToggleModule,
      QuillModule
    ]
})
export class EventsManagerModule { }
