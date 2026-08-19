import { BaseModel } from "../base.model";
import { Address } from "./utils/address.model";
import { Phone } from "./utils/phone.model";

// The person who fronts an organization for us. Embedded (not a ref) so an
// org can carry a PoC before that person exists as a Contact; "Promote to
// Contact" on the org screen creates/links the `customers` doc by email and
// records it in `contactId` (plus `organizationId` on the contact side).
export interface OrganizationPointOfContact {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: Phone;
    // customers/{id} once promoted/linked; absent until then.
    contactId?: string;
}

// An organization we keep in contact with (church, ministry, partner) -
// part of the Contacts world (Contacts Manager > Organizations) as of the
// 2026-08 restructure; it lived under Events Manager before that.
//
// An organization always owns its own mailing `address`. Multi-site orgs
// additionally have child location records (`locations` docs whose
// `organization` field is this org's id - see location.model.ts); a
// single-site org needs no location children at all, and an event held
// there uses the org's own address as its venue (see EventModel.venue).
export class OrganizationModel extends BaseModel {
    name: string;
    // DEPRECATED - superseded by pointOfContact (backfilled by
    // scripts/backfill-org-point-of-contact.js); kept readable for old
    // docs, no longer shown in the edit UI.
    contactName: string;
    address: Address;
    phone: Phone;
    email?: string;
    website?: string;
    pointOfContact?: OrganizationPointOfContact;

    constructor(){
        super();
    }
}
