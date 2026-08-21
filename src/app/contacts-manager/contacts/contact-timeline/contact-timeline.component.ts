import { Component, EventEmitter, Input, Output } from '@angular/core';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { CheckoutForm, FulfillmentStatus } from '@impact-common/shared/models/utils/cart.model';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { ContactNoteModel } from 'src/app/common/models/domain/utils/contact-note.model';
import { FULFILLMENT_STEPS } from '../../fulfillment/fulfillment-steps';

export type TimelineFilter = 'all' | 'purchase' | 'event' | 'note';

export interface TimelineEntry {
  type: 'purchase' | 'event' | 'note';
  date: Date | null;
  purchase?: CheckoutForm;
  registration?: EventRegistrationModel;
  note?: ContactNoteModel;
}

// The merged activity feed on the contact detail screen - purchases, event
// registrations and notes in one newest-first list with a type filter.
// Extracted from ContactDetailsComponent 2026-08-21 (bucket A item #5),
// which was 586 lines of TS + 254 of template across six concerns.
//
// PRESENTATIONAL on purpose: it takes an already-merged, already-sorted
// list and renders it. It does not fetch, merge, sort, filter-by-visibility
// or persist anything. In particular the private-note rule (only the author
// sees their own private notes) is applied by the HOST while building the
// feed, not here - so a note that must not be seen never reaches this
// component at all, rather than being hidden at render time. The note
// actions are emitted upward because the host owns the contact document.
//
// What it does own is the local view state: which type filter is active,
// and the small display lookups that only matter for rendering a row.
@Component({
    selector: 'app-contact-timeline',
    templateUrl: './contact-timeline.component.html',
    styleUrls: ['./contact-timeline.component.scss'],
    standalone: false
})
export class ContactTimelineComponent {
  /** Already merged and sorted newest-first by the host. Null while the
   *  host's streams have not emitted yet. */
  @Input() entries: TimelineEntry[] | null = null;
  /** Resolves an event registration's eventId to a name for display. */
  @Input() events: EventModel[] = [];
  /** True until BOTH of the host's activity streams have emitted - drives
   *  the overlay and suppresses the empty state while still loading. */
  @Input() loading = false;
  /** A save is in flight on the host, so adding a note is disabled. */
  @Input() busy = false;

  @Output() addNote = new EventEmitter<void>();
  @Output() deleteNote = new EventEmitter<ContactNoteModel>();
  @Output() saveNote = new EventEmitter<void>();

  activeFilter: TimelineFilter = 'all';

  filteredTimeline(entries: TimelineEntry[]): TimelineEntry[] {
    return this.activeFilter === 'all' ? entries : entries.filter((e) => e.type === this.activeFilter);
  }

  emptyMessage(): string {
    switch (this.activeFilter) {
      case 'purchase': return 'No purchases found for this contact.';
      case 'event': return 'No event registrations found for this contact.';
      case 'note': return 'No notes found for this contact.';
      default: return 'No purchases, events, or notes found for this contact.';
    }
  }

  getEventName(eventId: string): string {
    return this.events.find((event) => event.id === eventId)?.eventName ?? '';
  }

  // Same label lookup as purchases.component.ts's own
  // getFulfillmentStatusLabel() - this feed shows the same status this
  // customer's purchases carry on the main Purchases screen.
  getFulfillmentStatusLabel(status: FulfillmentStatus | undefined): string {
    return FULFILLMENT_STEPS.find((s) => s.status === status)?.statusLabel ?? 'Unknown';
  }
}
