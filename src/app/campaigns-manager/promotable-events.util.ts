import { EventModel } from '@impact-common/shared/models/domain/event.model';

/**
 * Which events a campaign may promote, and how to label them.
 *
 * The pickers used to load `isActive == true` only, which quietly excluded
 * the exact case the `earlyRegistration` feature exists for: a summit
 * created NOT LIVE whose sign-ups are open while its public page stays a
 * coming-soon placeholder. The Summit wizard tells staff to "pair with
 * CREATE (NOT LIVE) and share the direct registration link via a campaign",
 * and then the campaign builder would not list the event - the two halves
 * were built separately and never met.
 *
 * The honest rule is "can a visitor actually register for this?", which is
 * the same test `register_for_event` applies server-side
 * (`isActive !== false || earlyRegistration === true`). A plain inactive
 * event still stays out: nobody can register for it, so promoting it would
 * send people to a dead end.
 */
export function isPromotableEvent(event: EventModel): boolean {
  return event.isActive === true || event.earlyRegistration === true;
}

/**
 * Picker label. An early-registration event is spelled out rather than
 * shown as a bare name - otherwise it is indistinguishable from a live one,
 * and staff would have no way to tell that the page it points at is still a
 * placeholder.
 */
export function promotableEventLabel(event: EventModel): string {
  const name = event.eventName?.trim() || '(unnamed event)';
  return event.isActive === true
    ? name
    : `${name} (early registration — page not live)`;
}

/** The promotable subset, live events first, then by name. */
export function promotableEvents(events: EventModel[]): EventModel[] {
  return events.filter(isPromotableEvent).sort((a, b) => {
    if (a.isActive !== b.isActive) {
      return a.isActive === true ? -1 : 1;
    }
    return (a.eventName ?? '').localeCompare(b.eventName ?? '');
  });
}
