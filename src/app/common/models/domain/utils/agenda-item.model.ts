import { BaseModel } from "../../base.model";

export class AgendaItem extends BaseModel{
  text: string;
  name: string;
  startDate: Date;
  endDate: Date;
  course?: string;
  // Coach(es) speaking/leading a plain Agenda Item (e.g. a keynote) - for
  // a Course Session (isCourse: true) this is no longer the source of
  // truth, CourseModel.coachIds is (see its own comment) - `coaches` is
  // only read here as a display fallback for a course-type item saved
  // before that change, never written to by new course-type saves.
  coaches?: string[];
  isCourse?: boolean;
  isBreakout?: boolean;
  isFoodBreak?: boolean;
  maxParticipants?: number;
  signedUp?: number;
  description?: string;
  room?: string;
}
