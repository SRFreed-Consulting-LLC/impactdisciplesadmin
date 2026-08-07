import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import Query from 'devextreme/data/query';
import { DxSchedulerTypes } from 'devextreme-angular/ui/scheduler';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { CourseModel } from 'impactdisciplescommon/src/models/domain/course.model';
import { CoachModel } from 'impactdisciplescommon/src/models/domain/coach.model';
import { TrainingRoomModel } from 'impactdisciplescommon/src/models/domain/training-room.model';
import { CoachService } from 'impactdisciplescommon/src/services/data/coach.service';
import { CourseService } from 'impactdisciplescommon/src/services/data/course.service';
import { LocationService } from 'impactdisciplescommon/src/services/data/location.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import dxForm from 'devextreme/ui/form';

@Component({
    selector: 'app-event-agenda',
    templateUrl: './event-agenda.component.html',
    styleUrls: ['./event-agenda.component.css'],
    standalone: false
})
export class EventAgendaComponent implements OnInit{
  @Input('event') event: EventModel;
  @Output() onCloseWindow = new  EventEmitter<boolean>();

  draggingGroupName = 'appointmentsGroup';

  currentDate: Date;

  courses: CourseModel[] = [];
  coursesList: CourseModel[] = [];
  coaches: CoachModel[] = [];
  rooms: TrainingRoomModel[] = []

  constructor(private courseService: CourseService, private coachService: CoachService, private locationService: LocationService){}

  async ngOnInit(): Promise<void> {
    if(!this.event.agendaItems){
      this.event.agendaItems = [];
    }
    this.currentDate = dateFromTimestamp(this.event.startDate);

    this.courses = await this.courseService.getAll();

    this.coaches = await this.coachService.getAll();

    this.rooms = (await this.locationService.getById(typeof this.event.location=='string'? this.event.location : this.event.location.id)).trainingrooms;
  }

  getCoachById = (id: string) => Query(this.coaches).filter(['id', '=', id]).toArray()[0];
  getCourseById = (id: string) => Query(this.courses).filter(['id', '=', id]).toArray()[0];

  onAppointmentAdd = (e:any) => {
    e.appointmentData.id = this.generateEventId();
  };

  onAppointmentRemove = (e: DxSchedulerTypes.AppointmentDraggingRemoveEvent) => {
    const index = this.event.agendaItems.indexOf(e.itemData);

    if (index >= 0) {
      this.event.agendaItems.splice(index, 1);
      this.courses.push(e.itemData);
    }
  };

  onAppointmentFormOpening = (data: DxSchedulerTypes.AppointmentFormOpeningEvent) => {
    if(data.appointmentData['isCourse']){
      this.setSingleSessionCourseForm(data);
    } else if(data.appointmentData['isFoodBreak']){
      this.setFoodBreakForm(data);
    } else {
      this.setAgendaForm(data);
    }
  }

  setSingleSessionCourseForm(data: DxSchedulerTypes.AppointmentFormOpeningEvent){
    const that = this;
    const form = data.form;
    form.option().items = [{
      dataField: 'startDate',
      colSpan: 1,
      editorType: 'dxDateBox',
      editorOptions: {
        width: '100%',
        type: 'datetime'
      },
    }, {
      name: 'endDate',
      colSpan: 1,
      dataField: 'endDate',
      editorType: 'dxDateBox',
      editorOptions: {
        width: '100%',
        type: 'datetime',
      },
    }, {
      label: {
        text: 'Create Course?',
      },
      colSpan: 1,
      editorType: 'dxSwitch',
      dataField: 'isCourse',
      editorOptions: {
        switchedOnText: 'Yes',
        switchedOffText: 'No',
        onValueChanged({ value }) {
          if(!value){
            that.setAgendaForm(data);
          }
        }
      }
    }, {
      label: {
        text: 'Max Participants',
      },
      colSpan: 1,
      editorType: 'dxNumberBox',
      dataField: 'maxParticipants',
      editorOptions: {

      }
    },{
      label: {
        text: 'Course',
      },
      colSpan: 2,
      editorType: 'dxSelectBox',
      dataField: 'course',
      isRequired: true,
      editorOptions: {
        items: that.courses,
        displayExpr: 'title',
        valueExpr: 'id',
        value: data.appointmentData['course']? data.appointmentData['course']['id'] : '',
      },
    }, {
      label: {
        text: 'Coaches',
      },
      colSpan: 2,
      editorType: 'dxTagBox',
      dataField: 'coaches',
      isRequired: true,
      editorOptions: {
        items: that.coaches,
        displayExpr: 'fullname',
        valueExpr: 'id'
      },
    }, {
      label: {
        text: 'Room',
      },
      colSpan: 2,
      editorType: 'dxSelectBox',
      dataField: 'room',
      editorOptions: {
        showClearButton: true,
        items: that.rooms,
        displayExpr: 'name',
        valueExpr: 'id',
        onValueChanged({ value }) {
          that.setMaxParticipants(data, value, form);
        }
      },
    }];
    form.repaint();
  }

  setFoodBreakForm(data: DxSchedulerTypes.AppointmentFormOpeningEvent){
    const that = this;
    const form = data.form;
    form.option().colCount = 2;

    form.option().items = [{
      dataField: 'startDate',
      colSpan: 1,
      editorType: 'dxDateBox',
      editorOptions: {
        width: '100%',
        type: 'datetime'
      },
    }, {
      name: 'endDate',
      colSpan: 1,
      dataField: 'endDate',
      editorType: 'dxDateBox',
      editorOptions: {
        width: '100%',
        type: 'datetime',
      },
    }, {
      label: {
        text: 'Snack/Refreshment/Food Break?',
      },
      colSpan: 1,
      editorType: 'dxSwitch',
      dataField: 'isFoodBreak',
      editorOptions: {
        switchedOnText: 'Yes',
        switchedOffText: 'No',
        onValueChanged({ value }) {
          if(!value){
            that.setAgendaForm(data);
          }
        }
      }
    }, {
      label: {
        text: 'Title',
      },
      colSpan:2,
      isRequired: true,
      editorType: 'dxTextBox',
      dataField: 'text',
    }, {
      label: {
        text: 'Description',
      },
      colSpan:2,
      isRequired: true,
      editorType: 'dxTextArea',
      dataField: 'description'
    }, {
      label: {
        text: 'Room',
      },
      colSpan: 2,
      editorType: 'dxSelectBox',
      dataField: 'room',
      editorOptions: {
        items: that.rooms,
        displayExpr: 'name',
        valueExpr: 'id'
      },
    }];
    form.repaint();
  }

  setAgendaForm(data: DxSchedulerTypes.AppointmentFormOpeningEvent){
    const that = this;
    const form = data.form;
    form.option().colCount = 2;

    form.option().items = [{
      dataField: 'startDate',
      colSpan: 1,
      editorType: 'dxDateBox',
      editorOptions: {
        width: '100%',
        type: 'datetime'
      },
    }, {
      name: 'endDate',
      colSpan: 1,
      dataField: 'endDate',
      editorType: 'dxDateBox',
      editorOptions: {
        width: '100%',
        type: 'datetime',
      },
    }, {
      label: {
        text: 'Create Course?',
      },
      colSpan: 1,
      editorType: 'dxSwitch',
      dataField: 'isCourse',
      editorOptions: {
        switchedOnText: 'Yes',
        switchedOffText: 'No',
        onValueChanged({ value }) {
          if(value){
            that.setSingleSessionCourseForm(data)
          }
        }
      }
    },  {
      label: {
        text: 'Snack/Refreshment/Food Break?',
      },
      colSpan: 1,
      editorType: 'dxSwitch',
      dataField: 'isFoodBreak',
      editorOptions: {
        switchedOnText: 'Yes',
        switchedOffText: 'No',
        onValueChanged({ value }) {
          if(value){
            that.setFoodBreakForm(data)
          }
        }
      }
    }, {
      label: {
        text: 'Title',
      },
      colSpan:2,
      isRequired: true,
      editorType: 'dxTextBox',
      dataField: 'text',
    }, {
      label: {
        text: 'Coaches',
      },
      colSpan: 2,
      editorType: 'dxTagBox',
      dataField: 'coaches',
      editorOptions: {
        items: that.coaches,
        displayExpr: 'fullname',
        valueExpr: 'id'
      },
    }, {
      label: {
        text: 'Description',
      },
      colSpan:2,
      isRequired: true,
      editorType: 'dxTextArea',
      dataField: 'description'
    }, {
      label: {
        text: 'Room',
      },
      colSpan: 2,
      editorType: 'dxSelectBox',
      dataField: 'room',
      editorOptions: {
        items: that.rooms,
        displayExpr: 'name',
        valueExpr: 'id',
      },
    }];

    form.repaint();
  }

  setMaxParticipants(data: DxSchedulerTypes.AppointmentFormOpeningEvent, value: string, form:dxForm){
    let room = this.rooms.find(room => room.id == value)

    if(room && room.capacity && data.appointmentData['maxParticipants']){
      data.appointmentData['maxParticipants'] = room.capacity;
      form.updateData('maxParticipants', room.capacity);
    }
  }

  private generateEventId() {
    return 'xxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
