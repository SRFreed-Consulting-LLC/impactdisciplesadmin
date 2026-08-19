import { BaseModel } from "../../base.model";

// One entry in EventModel.agendaItems[]. A breakout session is an item with
// isCourse: true - since the 2026-08 Courses retirement it is fully
// self-contained: `text` is the breakout's title, `description` its
// description, `coaches` its instructor(s). Registrations reference these
// items directly (EventRegistrationModel.trainingSessions holds agenda-item
// ids, as does eventSessionCounts - verified against prod data), so an
// item's `id` must stay stable once anyone has registered for it.
// "Breakout blocks" are DERIVED, not stored - items sharing an identical
// start/end pair group into a block (see session-block.util.ts).
export class AgendaItem extends BaseModel{
  // For a breakout (isCourse) item: the breakout's display title. For plain
  // agenda items: the free-text line shown on the schedule.
  text: string;
  name: string;
  startDate: Date;
  endDate: Date;
  // LEGACY (frozen): pre-retirement link to a courses/{id} doc that held
  // the title/description. Never written by new saves; kept as provenance
  // and as the fallback key for the web's "same session at another time"
  // conflict check on old items. scripts/flatten-courses-onto-agenda-items.js
  // copied course title/description onto `text`/`description`.
  course?: string;
  // Instructor id(s) - each may live in `coaches` OR `impact_team` (see the
  // merged picker in event-agenda.component.ts). Source of truth for who
  // leads this item; CourseModel.coachIds never made it into real data and
  // is gone with the Courses retirement.
  coaches?: string[];
  isCourse?: boolean;
  isBreakout?: boolean;
  isFoodBreak?: boolean;
  maxParticipants?: number;
  signedUp?: number;
  description?: string;
  room?: string;
}
