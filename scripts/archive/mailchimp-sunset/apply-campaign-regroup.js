#!/usr/bin/env node
// Campaign Manager v2, Phase 1: APPLIES a reviewed regroup proposal
// (scripts/propose-campaign-regroup.js output) - creates merged v2
// campaign docs, repoints/annotates every campaign_emails touch, and
// deletes the absorbed 1:1 v1 campaign docs. Destructive by design, so:
//  - a FULL JSON backup of campaigns + campaign_emails is exported first
//    (the undo path),
//  - group doc ids are deterministic (grp_<slug>) and every write is a
//    set/merge, so a rerun after a partial failure converges instead of
//    duplicating,
//  - singleton groups keep their existing doc id and are rewritten in
//    place.
//
// Usage:
//   node scripts/archive/mailchimp-sunset/apply-campaign-regroup.js --project=dev [--proposal=<path>] [--execute]
// Dry run by default - prints the write plan; --execute applies it.

const fs = require("fs");
const path = require("path");
const {admin, resolveProjectId, getFirestoreFor} = require("../../lib/firestore-admin");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

// Long-running series stay open-ended (endDate null) so future touches
// keep attaching; everything else closes at its last send.
const OPEN_ENDED_KEYS = new Set([
  "series-prayer", "series-newsletter", "series-dmm", "series-blog",
  "series-podcast", "series-dmp",
]);

/** @param {string} value Name. @return {string} Slug for a doc id. */
function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/**
 * Maps a v1 campaign's stats block to the v2 EmailStats shape.
 * @param {object} v1 Old stats.
 * @return {object} EmailStats.
 */
function toEmailStats(v1) {
  return {
    sent: v1?.emailsSent ?? 0,
    delivered: 0,
    opens: v1?.opens ?? 0,
    uniqueOpens: v1?.uniqueOpens ?? 0,
    clicks: v1?.linkClicks ?? 0,
    uniqueClicks: 0,
    purchases: 0,
    revenue: 0,
    registrations: 0,
    subscribes: 0,
  };
}

/** @param {object[]} all Member EmailStats. @return {object} Summed CampaignStats. */
function sumStats(all) {
  const total = {
    sent: 0, delivered: 0, opens: 0, uniqueOpens: 0, clicks: 0,
    uniqueClicks: 0, purchases: 0, revenue: 0, registrations: 0,
    subscribes: 0, webShown: 0, webClicks: 0,
  };
  for (const s of all) {
    for (const key of Object.keys(s)) {
      total[key] += s[key];
    }
  }
  return total;
}

(async () => {
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);
  const execute = !!args.execute;
  const proposalPath = args.proposal ?? path.join(__dirname, "..", "..", "output", "regroup-proposal.json");
  const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
  if (proposal.projectId !== projectId) {
    throw new Error(`Proposal is for ${proposal.projectId}, but --project resolves to ${projectId}.`);
  }

  // ---- Backup first (the undo path), always - even on dry runs it's the
  // cheapest insurance and doubles as the doc snapshot the plan reads.
  const campaignsSnap = await db.collection("campaigns").get();
  const emailsSnap = await db.collection("campaign_emails").get();
  const backupPath = path.join(__dirname, "..", "..", "output",
      `regroup-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    projectId,
    campaigns: campaignsSnap.docs.map((d) => ({id: d.id, data: d.data()})),
    campaign_emails: emailsSnap.docs.map((d) => ({id: d.id, data: d.data()})),
  }));
  console.log(`Backup: ${backupPath} (${campaignsSnap.size} campaigns, ${emailsSnap.size} emails).`);

  const oldCampaigns = new Map(campaignsSnap.docs.map((d) => [d.id, d.data()]));

  // Deterministic group ids, uniquified on collision.
  const usedIds = new Set();
  const groupDocId = (group) => {
    if (group.members.length === 1) {
      return group.members[0].id; // singleton keeps its own doc id
    }
    let id = `grp_${slug(group.proposedName)}`;
    while (usedIds.has(id)) id += "-2";
    usedIds.add(id);
    return id;
  };

  let campaignsWritten = 0;
  let emailsUpdated = 0;
  let deleted = 0;

  for (const group of proposal.groups) {
    const docId = groupDocId(group);
    const memberStats = group.members.map((m) => toEmailStats(oldCampaigns.get(m.id)?.stats ?? m.stats));
    const sentTimes = group.members.map((m) => m.sentMs).filter(Boolean);
    const startMs = sentTimes.length ? Math.min(...sentTimes) : 0;
    const endMs = sentTimes.length ? Math.max(...sentTimes) : 0;
    const openEnded = OPEN_ENDED_KEYS.has(group.key);

    if (!execute) {
      console.log(`WOULD WRITE campaigns/${docId} "${group.proposedName}" (${group.members.length} email(s))`);
      continue;
    }

    await db.collection("campaigns").doc(docId).set({
      name: group.proposedName,
      goal: group.goal,
      otherKind: group.otherKind ?? null,
      productId: group.productId ?? null,
      eventId: group.eventId ?? null,
      channels: ["email"],
      status: "ended",
      startDate: startMs ? admin.firestore.Timestamp.fromMillis(startMs) : null,
      endDate: openEnded ? null : (endMs ? admin.firestore.Timestamp.fromMillis(endMs) : null),
      audience: null,
      couponId: null,
      source: "mailchimp",
      stats: sumStats(memberStats),
      schemaVersion: 2,
    });
    campaignsWritten++;

    for (const member of group.members) {
      const old = oldCampaigns.get(member.id);
      await db.collection("campaign_emails").doc(member.id).set({
        campaignId: docId,
        label: member.name,
        sentAt: member.sentMs ? admin.firestore.Timestamp.fromMillis(member.sentMs) : null,
        status: "sent",
        recipientCount: old?.stats?.emailsSent ?? 0,
        stats: toEmailStats(old?.stats ?? member.stats),
        mailchimpCampaignId: old?.mailchimpCampaignId ?? null,
        source: "mailchimp",
      }, {merge: true});
      emailsUpdated++;

      if (member.id !== docId) {
        await db.collection("campaigns").doc(member.id).delete();
        deleted++;
      }
    }
  }

  if (!execute) {
    console.log(`\nDry run: ${proposal.groups.length} campaigns would be written. Rerun with --execute.`);
    return;
  }

  // ---- Verify: every email points at an existing campaign; counts line up.
  const after = await db.collection("campaigns").count().get();
  const emailsAfter = await db.collection("campaign_emails").get();
  const campaignIds = new Set((await db.collection("campaigns").get()).docs.map((d) => d.id));
  const orphans = emailsAfter.docs.filter((d) => !campaignIds.has(d.data().campaignId));
  console.log(`\nDone. campaigns: ${after.data().count} (wrote ${campaignsWritten}, deleted ${deleted} absorbed v1 docs), ` +
    `campaign_emails updated: ${emailsUpdated}, orphaned emails: ${orphans.length}` +
    (orphans.length ? " <- INVESTIGATE: " + orphans.slice(0, 5).map((d) => d.id).join(", ") : ""));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
