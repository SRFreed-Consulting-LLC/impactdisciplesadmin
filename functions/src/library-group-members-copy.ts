export interface CopyableMember {
  email: string;
  displayName: string;
  status: string;
}

/**
 * Ported verbatim from impact-discipleship-library-manager-new's
 * group-members-copy.ts. Pure selection logic for copyGroupMembers: given
 * a source group's member records, which of them still need to be copied
 * into a target group as pre-approved members. Excludes anyone not
 * currently 'approved' in the source group, the calling leader themselves
 * (already written to the target the normal way), and anyone already
 * present in the target. `allowedEmails`, when provided, additionally
 * restricts the result to just that subset (the reader app's "Promote to
 * Next Book" flow) - omitted entirely, every approved member is eligible
 * (the original "clone the whole roster" behavior).
 * @param {Array<CopyableMember>} sourceMembers Source group's members.
 * @param {ReadonlySet<string>} existingTargetEmails Emails already present.
 * @param {string} callerEmail The leader's own email (excluded).
 * @param {ReadonlySet<string> | undefined} allowedEmails Optional subset.
 * @return {CopyableMember[]} Members that still need copying.
 */
export function selectMembersToCopy(
  sourceMembers: readonly CopyableMember[],
  existingTargetEmails: ReadonlySet<string>,
  callerEmail: string,
  allowedEmails?: ReadonlySet<string>
): CopyableMember[] {
  return sourceMembers.filter(
    (m) =>
      m.status === "approved" &&
      m.email !== callerEmail &&
      !existingTargetEmails.has(m.email) &&
      (!allowedEmails || allowedEmails.has(m.email))
  );
}
