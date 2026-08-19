import { BaseModel } from "../base.model";
import { TrainingRoomModel } from "./training-room.model";
import { Address } from "./utils/address.model";
import { Phone } from "./utils/phone.model";

// A site belonging to an organization - a CHILD record of an org as of the
// 2026-08 restructure (administered inside Contacts Manager > Organizations,
// no standalone Locations screen). The collection stays top-level
// `locations` (NOT a subcollection): the public site's LocationPipe and the
// summit schedule's room lookups read `locations/{id}` directly, and the
// collection's public-read rule depends on that shape.
export class LocationModel extends BaseModel {
  name: string;
  address: Address;
  contactName: string;
  phone: Phone;
  // Rooms + capacities, embedded. Only the summit venue (isSummitVenue)
  // carries these in practice; they are edited from the Summit screen's
  // Venue Rooms panel, nowhere else.
  trainingrooms: TrainingRoomModel[];
  // Parent org's id (organizations/{id}). Historically this could also be a
  // full OrganizationModel object from an old form save -
  // scripts/repair-location-organizations.js normalizes those to id strings;
  // treat string as the only real shape in new code.
  organization: string;
  // Exactly one location carries this flag: Crossroads Church HWY 16 Campus,
  // the fixed venue every Summit event happens at. Set by
  // scripts/pin-summit-venue.js - deliberately no UI writes it (a config
  // setting was considered and rejected; a queryable flag keeps the Summit
  // screen to one `locations` query with no config plumbing).
  isSummitVenue?: boolean;
}
