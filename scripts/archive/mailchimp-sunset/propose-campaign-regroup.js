#!/usr/bin/env node
// Campaign Manager v2, Phase 1: READ-ONLY grouping proposal for the
// imported Mailchimp archive. Each of the 477 imported sends is currently
// its own 1:1 campaign; this proposes how they merge into proper
// multi-email campaigns (recurring series like the Prayer Letter, per-
// event pushes, per-product pushes) for the user to review BEFORE
// scripts/apply-campaign-regroup.js applies anything.
//
// Usage:
//   node scripts/archive/mailchimp-sunset/propose-campaign-regroup.js --project=dev [--out=<dir>]
// Writes regroup-proposal.json + regroup-review.md to --out (default
// scripts/output/, gitignored data - never commit a proposal).

const fs = require("fs");
const path = require("path");
const {resolveProjectId, getFirestoreFor} = require("../../lib/firestore-admin");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "jan", "feb", "mar", "apr",
  "jun", "jul", "aug", "sept", "sep", "oct", "nov", "dec",
];
// Brand/common words that must never count as a distinctive match token.
// Tuned against the real archive (first pass matched 40 emails to one
// church's seminar on the word "church" alone).
const STOPWORDS = new Set([
  ...MONTHS, "impact", "disciples", "disciple", "discipleship", "making",
  "ministries", "ministry", "the", "and", "for", "with", "your", "our",
  "new", "now", "email", "newsletter", "letter", "update", "updates",
  "edition", "monthly", "copy", "resend", "days", "day", "week", "test",
  "church", "churches", "pastor", "pastors", "group", "groups", "seminar",
  "event", "events", "series", "life", "plan", "small", "what", "thank",
  "thanks", "doing", "together", "world", "spiritual", "growth",
  "christian", "leadership", "leaders", "training", "online", "digital",
  "essentials", "project", "character", "association", "workshop", "first",
  "baptist", "three", "four", "finding", "person", "special", "early",
  "bird", "sold", "starting", "soon", "opening", "last", "chance",
]);

/**
 * Normalizes a campaign/product/event title to a comparable stem: strips
 * months, years, issue numbers, punctuation, and noise words that only
 * distinguish issues of the same series.
 * @param {string} value Raw title.
 * @return {string} Normalized stem.
 */
function stemOf(value) {
  return (value ?? "")
      .toLowerCase()
      .replace(/\(copy \d+\)/g, " ")
      .replace(/resend:?/g, " ")
      .replace(/20\d\d/g, " ")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !MONTHS.includes(w))
      .join(" ")
      .trim();
}

/**
 * Distinctive tokens of a title - the words specific enough to identify a
 * product or event across differently-worded campaign titles.
 * @param {string} value Raw title.
 * @return {string[]} Tokens.
 */
function distinctiveTokens(value) {
  return (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

(async () => {
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);
  const outDir = args.out ?? path.join(__dirname, "..", "..", "output");
  fs.mkdirSync(outDir, {recursive: true});

  const campaignsSnap = await db.collection("campaigns").get();
  const imports = campaignsSnap.docs
      .filter((d) => d.data().source === "mailchimp" && !d.data().schemaVersion)
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name ?? "",
          subject: data.subject ?? "",
          sentMs: data.startDate?.toMillis?.() ?? 0,
          stats: data.stats ?? {},
        };
      })
      .sort((a, b) => a.sentMs - b.sentMs);
  const strays = campaignsSnap.size - imports.length;
  console.log(`Campaigns: ${campaignsSnap.size} total, ${imports.length} v1 Mailchimp imports to group` +
    (strays ? ` (${strays} other doc(s) left untouched - review manually!)` : "."));

  const products = (await db.collection("products").get()).docs
      .map((d) => ({id: d.id, title: d.data().title ?? "", tokens: distinctiveTokens(d.data().title)}));
  const events = (await db.collection("events").get()).docs
      .map((d) => ({id: d.id, name: d.data().eventName ?? "", tokens: distinctiveTokens(d.data().eventName)}));

  const groups = new Map();
  const addTo = (key, meta, campaign, evidence) => {
    if (!groups.has(key)) {
      groups.set(key, {key, ...meta, members: [], evidence});
    }
    groups.get(key).members.push(campaign);
  };

  // Token document frequencies for the Tier B match filters: how many
  // candidates (products+events) and how many campaign titles carry each
  // token.
  const candidateDf = new Map();
  for (const c of [...events, ...products]) {
    for (const t of new Set(c.tokens)) {
      candidateDf.set(t, (candidateDf.get(t) ?? 0) + 1);
    }
  }
  const campaignDf = new Map();
  for (const c of imports) {
    for (const t of new Set(distinctiveTokens(c.name + " " + c.subject))) {
      campaignDf.set(t, (campaignDf.get(t) ?? 0) + 1);
    }
  }

  for (const campaign of imports) {
    const title = campaign.name.toLowerCase();
    const tokens = distinctiveTokens(campaign.name + " " + campaign.subject);

    // Tier A: the two big recurring series. Prayer wins over newsletter
    // ("DM July Prayer Newsletter" is a prayer letter issue).
    if (/prayer/.test(title)) {
      addTo("series-prayer", {
        proposedName: "Prayer Letter", goal: "other", otherKind: "prayer-letter", confidence: "high",
      }, campaign, "title contains 'prayer'");
      continue;
    }
    if (/newsletter|news letter/.test(title)) {
      addTo("series-newsletter", {
        proposedName: "Monthly Newsletter", goal: "other", otherKind: "newsletter", confidence: "high",
      }, campaign, "title contains 'newsletter'");
      continue;
    }

    // Tier A2: the Disciple-Making Minute series (weekly content emails -
    // subjects carry the series name even when titles don't).
    if (/disciple.?making minute|(^|\W)dmm(\W|$)/.test(title + " " + campaign.subject.toLowerCase())) {
      addTo("series-dmm", {
        proposedName: "Disciple-Making Minute", goal: "other", otherKind: "general", confidence: "high",
      }, campaign, "title/subject contains 'Disciple-Making Minute'/'DMM'");
      continue;
    }

    // Tier A3: blog emails are content marketing, not product/event pushes
    // - they cluster by their own stem (send + resend pairs), never match
    // a product (first pass glued 9 "Leading Change" blogs to a product on
    // the word 'change').
    if (/blog/.test(title)) {
      const stem = stemOf(campaign.name.replace(/\*?blog\*?/gi, " "));
      addTo(`blog-${stem || campaign.id}`, {
        proposedName: "Blog: " + (stem || campaign.name).replace(/\b\w/g, (ch) => ch.toUpperCase()),
        goal: "other", otherKind: "general", confidence: "high",
      }, campaign, "blog content email; grouped by title stem");
      continue;
    }

    // Tier A4: Summits. Different years' summits are DIFFERENT campaigns,
    // and dev only holds the newest summit event doc - matching every
    // summit email to it would be wrong. Group per year found in the raw
    // title, linking the event doc only when its own name carries the year.
    if (/summit/.test(title)) {
      const year = (campaign.name.match(/20\d\d/) ?? [null])[0] ??
        (campaign.sentMs ? String(new Date(campaign.sentMs).getFullYear()) : "undated");
      const summitEvent = events.find((e) => /summit/i.test(e.name) && e.name.includes(year));
      addTo(`summit-${year}`, {
        proposedName: `Disciple-Making Summit ${year}`, goal: "event",
        eventId: summitEvent?.id ?? null, confidence: "medium",
      }, campaign, `title contains 'summit'; year ${year}` + (summitEvent ? ` matches event "${summitEvent.name}"` : ", no matching event doc"));
      continue;
    }

    // Tier B: event/product matches by distinctive-token overlap. A match
    // requires a token UNIQUE among all candidates (candidateDf == 1) -
    // the first pass showed shared words match everything to something -
    // and single-token matches must also be RARE across campaign titles
    // (campaignDf <= 3), or common prose words like 'change' still glue
    // unrelated emails to whichever product happens to use them.
    const best = (candidates) => {
      let top = null;
      for (const c of candidates) {
        const overlap = c.tokens.filter((t) => tokens.includes(t));
        const unique = overlap.filter((t) => candidateDf.get(t) === 1);
        if (unique.length === 0) continue;
        if (overlap.length < 2 && (unique[0].length < 5 || (campaignDf.get(unique[0]) ?? 0) > 3)) continue;
        if (!top || overlap.length > top.overlap.length) {
          top = {...c, overlap};
        }
      }
      return top;
    };
    const eventMatch = best(events);
    if (eventMatch) {
      addTo(`event-${eventMatch.id}`, {
        proposedName: eventMatch.name, goal: "event", eventId: eventMatch.id, confidence: "medium",
      }, campaign, `token overlap with event "${eventMatch.name}": ${eventMatch.overlap.join(", ")}`);
      continue;
    }
    const productMatch = best(products);
    if (productMatch) {
      addTo(`product-${productMatch.id}`, {
        proposedName: productMatch.title, goal: "product", productId: productMatch.id, confidence: "medium",
      }, campaign, `token overlap with product "${productMatch.title}": ${productMatch.overlap.join(", ")}`);
      continue;
    }

    // Tier C: same-stem clustering (issues of a series the tiers above
    // didn't name - e.g. "DMM" sends, seasonal appeals).
    const stem = stemOf(campaign.name);
    addTo(`stem-${stem || campaign.id}`, {
      proposedName: campaign.name, goal: "other", otherKind: "general", confidence: "low",
    }, campaign, stem ? `shared title stem "${stem}"` : "unparseable title");
  }

  // ---- User-approved consolidations (2026-08-18 review) ----
  // 1. ALL blog groups -> one "Blog Posts" series (like the DMM), each post
  //    a labeled email of it.
  // 2. DMP program-level sends -> one "Disciple-Making Pastor Program"
  //    campaign; ads naming a cohort leader (Ken/Mike/Ron) merge into that
  //    cohort's event campaign instead.
  // 3. Podcast stems -> one "Podcast" series.
  const mergeInto = (targetKey, meta, source) => {
    if (!groups.has(targetKey)) {
      groups.set(targetKey, {key: targetKey, ...meta, members: [], evidence: meta.evidence});
    }
    groups.get(targetKey).members.push(...source.members);
    groups.delete(source.key);
  };
  const COHORT_LEADERS = [
    {first: /\bken\b/, surname: /adams/i},
    {first: /\bmike\b/, surname: /keaton/i},
    {first: /\bron\b/, surname: /cansler|sumner/i},
  ];
  for (const group of [...groups.values()]) {
    if (group.key.startsWith("blog-")) {
      mergeInto("series-blog", {
        proposedName: "Blog Posts", goal: "other", otherKind: "general",
        confidence: "high", evidence: "all blog content sends - one series (user-approved)",
      }, group);
      continue;
    }
    const stem = group.key.startsWith("stem-") ? group.key.slice(5) : "";
    if (/podcast/.test(stem)) {
      mergeInto("series-podcast", {
        proposedName: "Podcast", goal: "other", otherKind: "general",
        confidence: "high", evidence: "podcast sends - one series (user-approved)",
      }, group);
      continue;
    }
    if (/disciple making pastor|(^|\s)dmp(\s|$)/.test(stem)) {
      const leader = COHORT_LEADERS.find((l) => l.first.test(stem));
      const cohort = leader &&
        [...groups.values()].find((g) => g.key.startsWith("event-") && leader.surname.test(g.proposedName));
      if (cohort) {
        cohort.members.push(...group.members);
        groups.delete(group.key);
      } else {
        mergeInto("series-dmp", {
          proposedName: "Disciple-Making Pastor Program", goal: "other", otherKind: "general",
          confidence: "high", evidence: "DMP program-level sends - one campaign (user-approved)",
        }, group);
      }
    }
  }

  // Cosmetic renames (user-approved cleanups of stem-derived names).
  const RENAMES = {
    "Impact Live Is Starting Soon": "Impact Live",
    "Dmc Seminar Ad": "DMC Seminar Ads",
  };

  // Stem clusters with one member are singletons (confidence high - no
  // grouping decision was made); multi-member stem clusters get a cleaner
  // proposed name (title-cased stem).
  const result = [];
  for (const group of groups.values()) {
    if (group.key.startsWith("stem-")) {
      if (group.members.length === 1) {
        group.confidence = "high";
        group.evidence = "singleton - stays its own campaign";
      } else {
        const stem = group.key.slice(5);
        group.proposedName = stem.replace(/\b\w/g, (ch) => ch.toUpperCase());
      }
    }
    if (RENAMES[group.proposedName]) {
      group.proposedName = RENAMES[group.proposedName];
    }
    group.members.sort((a, b) => a.sentMs - b.sentMs);
    result.push(group);
  }
  result.sort((a, b) => b.members.length - a.members.length);

  const multi = result.filter((g) => g.members.length > 1);
  const singles = result.length - multi.length;
  console.log(`Proposal: ${result.length} campaigns (${multi.length} multi-email groups, ${singles} singletons).`);
  for (const g of multi) {
    console.log(`  [${g.confidence.toUpperCase().padEnd(6)}] ${g.proposedName} (${g.goal}${g.otherKind ? "/" + g.otherKind : ""}): ${g.members.length} emails`);
  }

  const jsonPath = path.join(outDir, "regroup-proposal.json");
  fs.writeFileSync(jsonPath, JSON.stringify({projectId, generatedAt: new Date().toISOString(), groups: result}, null, 2));

  // Human-readable review doc, least-confident groups first.
  const order = {low: 0, medium: 1, high: 2};
  const review = ["# Campaign regroup proposal - review", "",
    `${imports.length} imported emails -> ${result.length} campaigns ` +
    `(${multi.length} groups, ${singles} singletons). Least-confident first.`, ""];
  for (const g of [...result].sort((a, b) => order[a.confidence] - order[b.confidence] || b.members.length - a.members.length)) {
    if (g.members.length === 1 && g.confidence === "high") continue; // singletons need no review
    review.push(`## ${g.proposedName}  \`${g.confidence}\` - ${g.goal}${g.otherKind ? "/" + g.otherKind : ""} - ${g.members.length} email(s)`);
    review.push(`_${g.evidence}_`);
    for (const m of g.members) {
      review.push(`- ${m.sentMs ? new Date(m.sentMs).toISOString().slice(0, 10) : "????-??-??"} · ${m.name}` +
        (m.subject && m.subject !== m.name ? ` — "${m.subject}"` : ""));
    }
    review.push("");
  }
  const mdPath = path.join(outDir, "regroup-review.md");
  fs.writeFileSync(mdPath, review.join("\n"));
  console.log(`\nWrote ${jsonPath}\n      ${mdPath}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
