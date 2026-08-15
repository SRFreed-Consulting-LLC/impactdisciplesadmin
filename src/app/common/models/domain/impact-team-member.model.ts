import { OrganizationModel } from "./organization.model";
import { Person } from "./utils/person.model";
import { ImageModel } from "../utils/image.model";

// Split off CoachModel (2026-08) - the `coaches` collection used to serve
// 2 unrelated purposes at once: driving the public "My Team" page AND
// providing breakout-session instructors for Summit events. This model is
// the public-facing half - whoever was previously a coach.teamPageSortOrder
// != null record (see MIGRATION.md for the one-time move). `sortOrder` here
// IS the team page order - there's no second, breakout-only sort concept
// on this model the way CoachModel still has both `sortOrder` and
// `teamPageSortOrder`, because this collection only has the one purpose.
//
// Still independently selectable as a breakout instructor though (see
// course-dialog.component.ts's combined Coaches + Impact Team picker) -
// splitting the collection doesn't mean an Impact Team member can't also
// lead a breakout, just that this collection's admin lifecycle (Web
// Manager > Team Page) is separate from CoachModel's (Events Manager >
// Coaches), matching who's expected to maintain each in practice.
export class ImpactTeamMemberModel extends Person {
  isActive = false;
  sortOrder: number;
  fullname: string;
  title: string;
  photoUrl: ImageModel;
  bio: string;
  // Either a full OrganizationModel (freshly picked in the form) or just its
  // id (as loaded from Firestore) - see organizationName()'s typeof check in
  // team-page.component.ts, same convention as coaches.component.ts.
  organization: OrganizationModel | string;
  url: string;

  constructor(){
    super();

    this.fullname = this.firstName + ' ' + this.lastName;
  }
}
