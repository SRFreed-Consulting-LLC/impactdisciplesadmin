import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { eventDayDates } from '../event-agenda/session-block.util';
import { countsByItemId, noBreakoutRegistrations, pickedPercent, sessionsNearCapacity, thisWeekCount } from '../summit-stats.util';
import { VenueRoomsDialogComponent } from '../venue-rooms-dialog.component';
import { SummitPreviewData } from '../summit-preview/summit-preview.component';
import { toTimeValue } from '../event-time.util';

// Summit Mission Control - what opening a summit from the list lands on
// (user decision 2026-08-19: "land on mission control"): an operations hub,
// not a form. Stat tiles + data-derived milestones + cards into the work
// areas; editing is one click deeper (the existing tab editor). Hosted by
// EventsComponent's mode === 'hub'; all navigation is emitted upward so the
// mode switching stays in one place.
@Component({
    selector: 'app-summit-hub',
    templateUrl: './summit-hub.component.html',
    styleUrls: ['./summit-hub.component.scss'],
    standalone: false
})
export class SummitHubComponent implements OnInit {
  @Input() event: EventModel;
  @Output() closed = new EventEmitter<void>();
  // Tab key of the editor to open ('info' | 'application' | 'agenda').
  @Output() edit = new EventEmitter<string>();
  @Output() openCommandCenter = new EventEmitter<void>();

  // The saved summit mapped for the preview rail. Was an @Input the parent
  // computed and pushed down (events.component.hubPreviewData()), which meant
  // EventsComponent derived preview data for a child that already held the
  // very object it derived it from - moved here 2026-08-21 (bucket A item #5).
  //
  // A getter, not a field: it is re-read each change-detection cycle, exactly
  // as the parent's `[preview]="hubPreviewData()"` binding was, so the timing
  // is unchanged. Deliberately reads `event` and NOT the re-fetched `fresh`
  // copy below - the parent fed the list's own item, and using the fresher
  // doc here would be a behaviour change, not a move. The hub never edits, so
  // this always previews SAVED values.
  get preview(): SummitPreviewData {
    const item = this.event;
    if (!item) return {};
    return {
      eventName: item.eventName,
      startDate: item.startDate as Date | string,
      endDate: item.endDate as Date | string,
      checkIn: toTimeValue(item.checkIn),
      description: item.description,
      videoId: item.videoId,
      imageUrl: item.imageUrl ?? null,
      venue: item.venue ?? null,
      costInDollars: item.costInDollars,
      diningOptions: item.diningOptions ?? null,
      checkinInstructions: item.checkinInstructions ?? null,
      whatsNext: item.whatsNext ?? null,
      faqList: item.faqList ?? null,
      agendaItems: item.agendaItems ?? null
    };
  }

  loading = true;
  registrations: EventRegistrationModel[] = [];
  fresh: EventModel | null = null;
  venue: LocationModel | null = null;

  // Derived (recomputed once after load).
  registrationCount = 0;
  weekDelta = 0;
  dayCount = 0;
  breakoutCount = 0;
  roomCount = 0;
  nearCapacityCount = 0;
  pickedPct = 0;
  emptyContentSections: string[] = [];

  constructor(
    private eventService: EventService,
    private registrationService: EventRegistrationService,
    private locationService: LocationService,
    private dialog: MatDialog
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const [registrations, fresh, venues] = await Promise.all([
        this.registrationService.getAllByValue('eventId', this.event.id!),
        this.eventService.getById(this.event.id!),
        this.locationService.getAllByValue('isSummitVenue', true)
      ]);
      this.registrations = registrations;
      this.fresh = fresh ?? this.event;
      this.venue = venues[0] ?? null;
      this.recompute();
    } finally {
      this.loading = false;
    }
  }

  private recompute(): void {
    const event = this.fresh!;
    this.registrationCount = this.registrations.length;
    this.weekDelta = thisWeekCount(this.registrations);
    this.dayCount = eventDayDates(event.startDate, event.endDate).length;
    this.breakoutCount = (event.agendaItems ?? []).filter((i) => i.isCourse).length;
    this.roomCount = this.venue?.trainingrooms?.length ?? 0;
    const counts = countsByItemId(this.registrations);
    this.nearCapacityCount = sessionsNearCapacity(event, counts).length;
    this.pickedPct = pickedPercent(this.registrations);

    this.emptyContentSections = [
      ...(event.diningOptions ? [] : ['Dining']),
      ...(event.checkinInstructions ? [] : ['Check-In']),
      ...((event.faqList ?? []).length ? [] : ['FAQs']),
      ...(event.whatsNext ? [] : ["What's Next"])
    ];
  }

  daysUntil(): number {
    const ms = toMillis(this.event.startDate) - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }

  isPast(): boolean {
    return toMillis(this.event.endDate ?? this.event.startDate) < Date.now();
  }

  noBreakoutCount(): number {
    return noBreakoutRegistrations(this.registrations).length;
  }

  venueAddress(): string {
    const a = this.venue?.address;
    if (!a) return '';
    return [a.address1, a.city, a.state].filter(Boolean).join(', ');
  }

  openVenueRooms(): void {
    this.dialog.open(VenueRoomsDialogComponent, { width: '760px', maxWidth: '95vw' });
  }
}
