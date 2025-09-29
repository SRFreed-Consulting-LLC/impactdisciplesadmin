import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CoursesComponent } from './courses/courses.component';
import { LocationsComponent } from './locations/locations.component';
import { DxButtonModule, DxContextMenuModule, DxDataGridModule, DxDateBoxModule, DxDraggableModule, DxDropDownBoxModule, DxFileManagerModule, DxFormModule, DxHtmlEditorModule,
  DxListModule, DxLoadIndicatorModule, DxLoadPanelModule, DxLookupModule, DxNumberBoxModule, DxPopupModule, DxSchedulerModule, DxScrollViewModule, DxSelectBoxModule, DxSwitchModule, DxTabsModule, DxTagBoxModule, DxTextAreaModule, DxTextBoxModule, DxToolbarModule } from 'devextreme-angular';
import { OrganizationsComponent } from './organizations/organizations.component';
import { ImpactDisciplesCommonModule } from "../../../impactdisciplescommon/src/impactdisciples.common.module";
import { CoachesComponent } from './coaches/coaches.component';
import { EventsComponent } from './events/events.component';
import { EventAttendeesComponent } from './events/event-attendees/event-attendees.component';
import { EventAgendaComponent } from './events/event-agenda/event-agenda.component';
import { EventsManagerComponent } from './events-manager.component';
import { SharedModule } from '../shared/shared.module';
import { RoomComponent } from './locations/room/room.component';
import { FAQComponent } from './events/event-application/questions-and-answers/faq.component';
import { AnnouncementsComponent } from './events/event-application/announcements/announcements.component';
import { EventApplicationComponent } from './events/event-application/event-application.component';
import { DetailsComponent } from './events/event-application/details/details.component';
import { EventBreakoutsComponent } from './events/event-breakouts/event-breakouts.component';
import { ImageUploaderModule } from 'impactdisciplescommon/src/forms/image-uploader/image-uploader.module';

@NgModule({
    declarations: [
      EventsManagerComponent,
      EventsComponent,
      CoursesComponent,
      CoachesComponent,
      LocationsComponent,
      OrganizationsComponent,
      EventAgendaComponent,
      EventAttendeesComponent,
      EventBreakoutsComponent,
      RoomComponent,
      FAQComponent,
      AnnouncementsComponent,
      EventApplicationComponent,
      DetailsComponent
    ],
    imports: [
      CommonModule,
      SharedModule,
      FormsModule,
      ImageUploaderModule,
      DxButtonModule,
      DxContextMenuModule,
      DxDataGridModule,
      DxDateBoxModule,
      DxDraggableModule,
      DxFormModule,
      DxFileManagerModule,
      DxHtmlEditorModule,
      DxLookupModule,
      DxLoadPanelModule,
      DxListModule,
      DxNumberBoxModule,
      DxPopupModule,
      DxSchedulerModule,
      DxScrollViewModule,
      DxSwitchModule,
      DxTabsModule,
      DxTagBoxModule,
      DxTextAreaModule,
      DxTextBoxModule,
      DxToolbarModule,
      DxSelectBoxModule,
      DxDropDownBoxModule,
      DxLoadIndicatorModule,
      ImpactDisciplesCommonModule
    ]
})
export class EventsManagerModule { }
