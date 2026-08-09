import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CoursesComponent } from './courses/courses.component';
import { LocationsComponent } from './locations/locations.component';
import { OrganizationsComponent } from './organizations/organizations.component';
import { ImpactDisciplesCommonModule } from "../../../impactdisciplescommon/src/impactdisciples.common.module";
import { CoachesComponent } from './coaches/coaches.component';
import { CoachDialogComponent } from './coaches/coach-dialog.component';
import { EventsComponent } from './events/events.component';
import { EventAttendeesComponent } from './events/event-attendees/event-attendees.component';
import { EventAttendeeDialogComponent } from './events/event-attendees/event-attendee-dialog.component';
import { EventEmailDialogComponent } from './events/event-attendees/event-email-dialog.component';
import { EventAgendaComponent } from './events/event-agenda/event-agenda.component';
import { AgendaItemDialogComponent } from './events/event-agenda/agenda-item-dialog.component';
import { EventsManagerComponent } from './events-manager.component';
import { SharedModule } from '../shared/shared.module';
import { RoomComponent } from './locations/room/room.component';
import { FAQComponent } from './events/event-application/questions-and-answers/faq.component';
import { FaqDialogComponent } from './events/event-application/questions-and-answers/faq-dialog.component';
import { AnnouncementsComponent } from './events/event-application/announcements/announcements.component';
import { EventApplicationComponent } from './events/event-application/event-application.component';
import { EventBreakoutsComponent } from './events/event-breakouts/event-breakouts.component';
// This app's own Material file browser, replacing the DevExtreme
// dx-file-manager-backed app-image-uploader from impactdisciplescommon -
// see src/app/shared/image-uploader/ for the full rationale (built during
// the Web Manager migration, reused throughout Store Manager).
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';
import { EventsManagerRoutingModule } from './events-manager-routing.module';
import { CourseDialogComponent } from './courses/course-dialog.component';
import { RoomDialogComponent } from './locations/room/room-dialog.component';
import { AnnouncementDialogComponent } from './events/event-application/announcements/announcement-dialog.component';
import { OrganizationDialogComponent } from './organizations/organization-dialog.component';
import { LocationDialogComponent } from './locations/location-dialog.component';
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
import { QuillModule } from 'ngx-quill';
// Replaces DevExtreme's dx-scheduler on the Agenda tab - see
// event-agenda.component.ts for the full rationale. angular-calendar
// ships standalone components/directives/pipes only (no NgModule
// wrapper); these drop directly into this NgModule's own imports array
// like any other standalone piece, with provideCalendar() below supplying
// the required DateAdapter.
import {
  CalendarDatePipe,
  CalendarNextViewDirective,
  CalendarPreviousViewDirective,
  CalendarTodayDirective,
  CalendarWeekViewComponent,
  DateAdapter,
  provideCalendar
} from 'angular-calendar';
import { adapterFactory } from 'angular-calendar/date-adapters/date-fns';

@NgModule({
    declarations: [
      EventsManagerComponent,
      EventsComponent,
      CoursesComponent,
      CourseDialogComponent,
      CoachesComponent,
      CoachDialogComponent,
      LocationsComponent,
      LocationDialogComponent,
      OrganizationsComponent,
      OrganizationDialogComponent,
      EventAgendaComponent,
      AgendaItemDialogComponent,
      EventAttendeesComponent,
      EventAttendeeDialogComponent,
      EventEmailDialogComponent,
      EventBreakoutsComponent,
      RoomComponent,
      RoomDialogComponent,
      FAQComponent,
      FaqDialogComponent,
      AnnouncementsComponent,
      AnnouncementDialogComponent,
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
      QuillModule,
      CalendarWeekViewComponent,
      CalendarPreviousViewDirective,
      CalendarNextViewDirective,
      CalendarTodayDirective,
      CalendarDatePipe
    ],
    providers: [
      provideCalendar({
        provide: DateAdapter,
        useFactory: adapterFactory
      })
    ]
})
export class EventsManagerModule { }
