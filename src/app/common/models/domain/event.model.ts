import { LocationModel } from './location.model';
import { BaseModel } from "../base.model";
import { AdminUser } from '../admin/admin-user.model';
import { Timestamp } from 'firebase/firestore';
import { OrganizationModel } from './organization.model';
import { AgendaItem } from './utils/agenda-item.model';
import { FAQModel } from '../utils/faq.model';
import { ImageModel } from '../utils/image.model';
import { Address } from './utils/address.model';

// Where this event happens, snapshotted at admin save time from the chosen
// location record - or, when the organization has no location children,
// from the org's own name + address. Denormalized ON PURPOSE: the public
// site renders this directly, because `organizations` is staff-only
// readable (and stays that way - opening it to public read was considered
// and rejected). Staleness is accepted: editing an org's address does NOT
// retro-apply to already-saved events; re-saving the event refreshes it.
export interface EventVenue {
  name: string;
  address: Address;
}

export class EventModel extends BaseModel {
  isActive = false;
  eventName?: string;
  organization?: string | OrganizationModel;
  startDate?: Timestamp | Date | string;
  endDate?: Timestamp | Date | string;
  // A child location of `organization` (locations/{id}) - optional as of
  // the 2026-08 restructure: a single-site org's event has no location and
  // the venue is the org's own address (see `venue`). Summit events always
  // point at the pinned isSummitVenue location (see location.model.ts).
  location?: string | LocationModel;
  venue?: EventVenue;
  attendees?: AdminUser[];
  agendaItems?: AgendaItem[];
  description?: string;
  costInDollars?: number;
  isSummit?: boolean = false;
  // Summit-only (2026-08-20): accept registrations while the event is NOT
  // yet live on the public site - the summit page keeps its coming-soon
  // placeholder; an early-bird campaign links straight to
  // /event-details/{id}. register_for_event honors isActive OR this flag.
  earlyRegistration?: boolean = false;
  isOnline?: boolean = false;
  isKajabiCourse?: boolean = false;
  kajabiPurchaseURL?: string;
  kajabiSubscribeURL?: string;
  imageUrl?: ImageModel;
  emailTemplate?: string;
  videoId?: string;
  faqList: FAQModel[] = [];
  checkIn?: Timestamp;
  diningOptions?: string;
  whatsNext?: string;
  checkinInstructions?: string;
}
