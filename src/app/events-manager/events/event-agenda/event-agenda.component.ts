import { Component, Input, OnInit } from '@angular/core';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { TrainingRoomModel } from 'src/app/common/models/domain/training-room.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { CourseService } from 'src/app/common/services/data/course.service';
import { LocationService } from 'src/app/common/services/data/location.service';

type AgendaMode = 'wizard' | 'canvas' | 'grid';

// Agenda tab shell - a thin mode-switching wrapper around the redesigned
// Summit agenda builder (see the Summit Agenda Builder redesign plan).
// Replaces the old angular-calendar week-view scheduler entirely; the
// actual editing UI lives in the three child components below, each
// taking the same @Input() event/courses/coaches/rooms this used to load
// for the calendar and its item dialog. Courses/coaches/rooms are still
// loaded exactly the same way as the old calendar version did (one-time
// getAll()/getById().trainingrooms, not streamAll() - see those call
// sites' own history for why cold-load WebChannel races make that the
// right call for small reference lists feeding a dialog).
//
// `event.agendaItems` is still mutated in place by whichever child is
// active - nothing here (or in any child) writes to Firestore on its own;
// that still only happens when events.component.ts's own Save runs.
@Component({
    selector: 'app-event-agenda',
    templateUrl: './event-agenda.component.html',
    styleUrls: ['./event-agenda.component.scss'],
    standalone: false
})
export class EventAgendaComponent implements OnInit {
  @Input() event: EventModel;

  mode: AgendaMode = 'wizard';

  courses: CourseModel[] = [];
  coaches: CoachModel[] = [];
  rooms: TrainingRoomModel[] = [];

  constructor(
    private courseService: CourseService,
    private coachService: CoachService,
    private locationService: LocationService
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.event.agendaItems) {
      this.event.agendaItems = [];
    }

    this.courses = await this.courseService.getAll();
    this.coaches = await this.coachService.getAll();

    const locationId = typeof this.event.location === 'string' ? this.event.location : this.event.location?.id;
    this.rooms = locationId ? ((await this.locationService.getById(locationId))?.trainingrooms ?? []) : [];

    // Existing Summit events - built entirely under the old calendar-only
    // Agenda tab - already have agendaItems the first time anyone opens
    // them in this new UI; land straight on the fine-tune view for those
    // rather than forcing a redundant Wizard pass over data that's
    // already there. This is what makes an existing event "just work"
    // with zero migration - session-block.util.ts derives its blocks from
    // whatever agendaItems already exist, however they got there.
    this.mode = (this.event.agendaItems?.length ?? 0) > 0 ? 'canvas' : 'wizard';
  }

  setMode(mode: AgendaMode): void {
    this.mode = mode;
  }

  onPublished(): void {
    this.mode = 'canvas';
  }
}
