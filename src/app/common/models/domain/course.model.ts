import { BaseModel } from '../base.model';

export class CourseModel extends BaseModel {
  title: string;
  shortDescription: string;
  longDescription: string;
  resources: string;
  length: string;
  // The coach(es) who teach this course - the source of truth for "who
  // teaches this" now that a breakout session (an AgendaItem with
  // isCourse: true) no longer picks its own coach independently. A course
  // can have more than one coach (co-taught). Old AgendaItems from before
  // this existed may still carry their own `coaches` - see AgendaItem's
  // own comment and session-block.util.ts's coachLabelFor() for the
  // display fallback, kept for backward compat rather than migrated.
  coachIds?: string[];
}
