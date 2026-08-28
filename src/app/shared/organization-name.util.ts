import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';

/** Any record that references an organization the way coaches and Impact
 *  Team members do - either the id as a string, or the object. */
export interface HasOrganization {
  organization?: string | { id?: string } | null;
}

/**
 * The display name of a record's organization, or '' when there isn't one.
 *
 * Existed identically in coaches.component.ts and team-page.component.ts
 * (2026-08-27 sweep, P4) over two different models. Shared because the
 * lookup is incidental to both screens - what differs between them is the
 * dataset, not how an organization id becomes a name.
 *
 * Handles BOTH stored shapes on purpose: some records carry the id as a
 * plain string, others the whole object. Returning '' rather than a
 * placeholder is deliberate - the grid renders an empty cell for a coach
 * with no organization, not a dash or "Unknown".
 * @param {HasOrganization} item The coach or team member.
 * @param {OrganizationModel[]} organizations The organizations on file.
 * @return {string} The organization's name, or ''.
 */
export function organizationNameOf(
  item: HasOrganization,
  organizations: OrganizationModel[]
): string {
  const orgId =
    typeof item.organization === 'string' ? item.organization : item.organization?.id;
  return organizations.find((o) => o.id === orgId)?.name ?? '';
}
