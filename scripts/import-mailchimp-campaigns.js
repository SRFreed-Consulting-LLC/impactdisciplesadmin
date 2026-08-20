#!/usr/bin/env node
// Imports the Mailchimp account's SENT campaigns as this app's email-
// campaign HISTORY: one `campaigns` doc (type 'email', status 'ended',
// stats mapped from Mailchimp's report_summary) plus one `campaign_emails`
// doc (the rendered html body, same doc id) per sent campaign. Rerunnable -
// doc ids are deterministic (`mc_<mailchimpCampaignId>`), so a rerun
// refreshes rather than duplicates.
//
// Also: with --delete-handmade (opt-in since 2026-08-20; the 2026-08-18 dev
// run did this unconditionally, user-sanctioned for dev's one throwaway
// draft) deletes any pre-existing hand-created campaigns (`source` !=
// 'mailchimp') on --execute, and with
// --cleanup-templates removes from `mail_templates` the docs that were
// really historical sent emails (the sent-campaign-derived "(Mailchimp)"
// imports - identified by a non-empty subject, which only that import path
// wrote) plus any exact-name duplicates among the remaining "(Mailchimp)"
// template imports. Their content stays reachable: the campaign import
// carries every sent email into the Sent Emails screen / Past Emails picker.
//
// Usage (single PowerShell call - env vars don't persist between calls):
//   $env:MAILCHIMP_API_KEY = (firebase functions:secrets:access MAILCHIMP_API_KEY --project impactdisciplesdev); node scripts/import-mailchimp-campaigns.js --project=dev [--execute] [--cleanup-templates]
// Without --execute it reports what WOULD happen (dry run).

const {admin, resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

const API_KEY = (process.env.MAILCHIMP_API_KEY || "").trim();
if (!API_KEY || !API_KEY.includes("-")) {
  console.error("Set MAILCHIMP_API_KEY (format xxxx-usNN) in the environment.");
  process.exit(1);
}
const DC = API_KEY.split("-").pop();
const BASE = `https://${DC}.api.mailchimp.com/3.0`;
const AUTH = "Basic " + Buffer.from("anystring:" + API_KEY).toString("base64");

/**
 * Mailchimp API GET helper.
 * @param {string} pathname API path.
 * @return {Promise<object>} Parsed response.
 */
async function mc(pathname) {
  const response = await fetch(BASE + pathname, {headers: {"Authorization": AUTH}});
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GET ${pathname} -> ${response.status}: ${data?.detail ?? data?.title ?? "unknown"}`);
  }
  return data;
}

/**
 * Runs tasks with bounded concurrency (the 477 per-campaign content fetches
 * dominate the runtime; serial would take many minutes).
 * @param {Array<() => Promise<void>>} tasks Thunks.
 * @param {number} width Concurrent task cap.
 * @return {Promise<void>} Resolves when all tasks settle.
 */
async function pool(tasks, width) {
  const queue = [...tasks];
  const workers = Array.from({length: width}, async () => {
    while (queue.length) {
      const task = queue.shift();
      await task();
    }
  });
  await Promise.all(workers);
}

(async () => {
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);
  const execute = !!args.execute;

  // ---- 0. Pre-existing hand-created campaigns. The 2026-08-18 dev run
  // deleted dev's single throwaway draft (user-sanctioned then); since
  // 2026-08-20 that is OPT-IN via --delete-handmade, because prod carried a
  // real in-progress campaign ("Summit Early Bird Special" + its popup)
  // when the import reached it. Default: keep them - the import only ever
  // writes its own deterministic mc_* docs and never needs the others gone.
  const existing = await db.collection("campaigns").get();
  const handmade = existing.docs.filter((d) => d.data().source !== "mailchimp");
  const deleteHandmade = !!args["delete-handmade"];
  console.log(`Existing campaigns: ${existing.size} (${handmade.length} hand-created -> ` +
    `${deleteHandmade ? (execute ? "DELETING" : "would delete") : "KEPT (pass --delete-handmade to remove)"}).`);
  if (execute && deleteHandmade) {
    for (const doc of handmade) {
      await doc.ref.delete();
    }
  }

  // ---- 1. The archive + the saved-template list (for "started from" links).
  const list = await mc(
    "/campaigns?status=sent&count=1000&sort_field=send_time&sort_dir=DESC" +
    "&fields=campaigns.id,campaigns.send_time,campaigns.settings.title," +
    "campaigns.settings.subject_line,campaigns.settings.template_id," +
    "campaigns.recipients.recipient_count,campaigns.report_summary,total_items");
  const campaigns = list.campaigns ?? [];
  console.log(`Sent campaigns in Mailchimp (${DC}): ${campaigns.length} of ${list.total_items} total.`);

  const templates = (await mc("/templates?type=user&count=200")).templates ?? [];
  const templateNameById = new Map(templates.map((t) => [t.id, t.name.trim()]));

  // Our imported saved templates are named "<mailchimp name> (Mailchimp)".
  const mailTemplatesSnap = await db.collection("mail_templates").get();
  const ourTemplateIdByName = new Map(
    mailTemplatesSnap.docs.map((d) => [d.data().name, d.id]));

  if (!execute) {
    console.log(`DRY RUN: would import ${campaigns.length} campaign(s) as type 'email' + campaign_emails bodies.`);
  } else {
    let done = 0;
    let failed = 0;
    await pool(campaigns.map((campaign) => async () => {
      try {
        const content = await mc(`/campaigns/${campaign.id}/content?fields=html`);
        const html = content.html ?? "";
        const docId = `mc_${campaign.id}`;
        const sendTime = campaign.send_time ?
          admin.firestore.Timestamp.fromDate(new Date(campaign.send_time)) : null;
        const report = campaign.report_summary ?? {};
        const mcTemplateName = templateNameById.get(campaign.settings?.template_id) ?? null;
        const ourTemplateId = mcTemplateName ?
          (ourTemplateIdByName.get(`${mcTemplateName} (Mailchimp)`) ?? null) : null;

        await db.collection("campaigns").doc(docId).set({
          name: campaign.settings?.title ?? campaign.settings?.subject_line ?? "(untitled)",
          type: "email",
          status: "ended",
          startDate: sendTime,
          endDate: sendTime,
          subject: campaign.settings?.subject_line ?? "",
          templateName: mcTemplateName,
          emailTemplateId: ourTemplateId,
          source: "mailchimp",
          mailchimpCampaignId: campaign.id,
          stats: {
            emailsSent: campaign.recipients?.recipient_count ?? 0,
            linkClicks: report.clicks ?? 0,
            opens: report.opens ?? 0,
            uniqueOpens: report.unique_opens ?? 0,
            leads: 0, redemptions: 0, registrations: 0, revenue: 0,
          },
        });
        await db.collection("campaign_emails").doc(docId).set({
          campaignId: docId,
          subject: campaign.settings?.subject_line ?? "",
          html,
          source: "mailchimp",
          capturedAt: admin.firestore.Timestamp.now(),
        });
        done++;
        if (done % 25 === 0) console.log(`  ${done}/${campaigns.length} imported...`);
      } catch (err) {
        failed++;
        console.log(`  FAILED ${campaign.settings?.title ?? campaign.id}: ${err.message}`);
      }
    }), 8);
    console.log(`Imported ${done}, failed ${failed}.`);
  }

  // ---- 2. Reclassify: the sent-campaign-derived mail_templates docs were
  // history, not templates - remove them (plus exact-name dupes among the
  // real "(Mailchimp)" template imports).
  if (args["cleanup-templates"]) {
    const mailchimpDocs = mailTemplatesSnap.docs
      .filter((d) => (d.data().name ?? "").endsWith("(Mailchimp)"));
    const historical = mailchimpDocs.filter((d) => (d.data().subject ?? "") !== "");
    const seenNames = new Set();
    const dupes = [];
    for (const doc of mailchimpDocs.filter((d) => (d.data().subject ?? "") === "")) {
      const name = doc.data().name;
      if (seenNames.has(name)) dupes.push(doc);
      else seenNames.add(name);
    }
    console.log(`\nCleanup: ${historical.length} historical + ${dupes.length} duplicate template doc(s):`);
    for (const doc of [...historical, ...dupes]) {
      console.log(`  ${execute ? "DELETING" : "would delete"}: ${doc.data().name} (${doc.id})`);
      if (execute) await doc.ref.delete();
    }
  }

  if (execute) {
    const campaignCount = (await db.collection("campaigns").count().get()).data().count;
    const emailCount = (await db.collection("campaign_emails").count().get()).data().count;
    console.log(`\nDone. campaigns: ${campaignCount}, campaign_emails: ${emailCount}.`);
  } else {
    console.log("\nDry run done - rerun with --execute to import.");
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
