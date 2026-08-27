# Prod runbook — email template reorganisation

Everything in commits `2d6ce4a`, `5e90a6d`, `a8517b6`, `b069bf7`. All of it is
live and exercised on dev; **none of it is on prod.**

This is not a hosting release. It is a **functions deploy plus eight data
migrations**, and the order matters — the code reads data the migrations
write, and one migration deletes documents.

Prod is `impactdisciples-a82a8`. Dev is `impactdisciplesdev`.

---

## What is being fixed

Two of these are live defects on prod right now, not just tidying:

1. **A checkout can be mailed any template it names.** `followUpEmailId` rode
   through from the client, unvalidated, onto the purchase and into the send.
   Combined with the store's five **$0 products** (total ≤ 0 skips PayPal
   entirely) the gated "Healthy Marriage" video link is free to anyone who
   edits one request field. Fixed in `create_paypal_order` /
   `capture_paypal_order`.
2. **Two live emails have a dead contact link** — `href="[object Object]"` in
   Disciple-Making Church Seminar Receipt (10 events, **2 active and
   upcoming**) and Healthy Marriage Videos. Fixed by the conversions.

Plus: one active event sends **no confirmation at all**, and five active
events mail registrants something titled *"Sales Receipt from Impact
Ministries"*.

---

## Prod state before you start

10 templates, every one legacy Quill, nine of them still `system`:

| kind | template | doc id | events (total/active) |
|---|---|---|---|
| fulfillment | Amazon Shipping Confirmation | `c2aqLkyMVgkXkVnyFLws` | — (code) |
| system | Sales Receipt | `8vcqN0RtMvQwckCqdcn2` | 5 / **5** |
| system | Disciple-Making Church Seminar Receipt | `A6I1EBzRFD51v5satapH` | 10 / **2** |
| system | Elevate Workshops Registration Success | `9TTMLWiNOkGuteSgBnal` | 6 / 0 |
| system | Impact Disciple-Making Network | `u15IqKR6hJ4pCLQ6xRFA` | 1 / 0 |
| system | Seminar Template | `qVWQCIMvFpAUaMeDMl0T` | 3 / 0 |
| system | Summit Registration 2027 | `HE6darZaFrcZprPF002l` | 1 / 0 |
| system | Summit Registration Success Template | `NaQwZmYwitwisQAVOBJq` | 1 / 0 |
| system | Whitewater Campus Receipt | `aVjQdASE9QlAIK6Z8POU` | 1 / 0 |
| system | Healthy Marriage Videos | `ndAZRu20F8FD2kpUR93L` | 1 product |

**"NEW! Disciple-Making Church Pastor Ken Adams" is active with no template.**

Note `Amazon Shipping Confirmation` has a **different doc id on prod** than on
dev — which is exactly why step 3 exists.

---

## 0. Before anything

```bash
cd "impactdisciples - admin"
npm run backup:prod            # functions + data are involved: required
git log --oneline -1           # expect b069bf7 or later
npm test && cd functions && npm test && cd ..
```

Every script below is **dry-run by default**. Run each without `--execute`
first and read the output. They write backups into `scripts/output/`, which is
gitignored — do not clear it between steps, several are the only undo.

---

## 1. Functions FIRST

The client never sends `followUpEmailId` any more, and the new render path
lives server-side. Deploy functions before hosting, per `.claude/commands/deploy.md`.

```powershell
firebase deploy --only "functions:create_paypal_order,functions:capture_paypal_order,functions:register_for_event" --project impactdisciples-a82a8
```

Run from **PowerShell**, not Git Bash — the predeploy hook fails to spawn
under bash. A 429 is not a failure; re-run and finished functions report
"Skipped".

**Safe to do first:** every template lookup falls back to the old name-based
path, so functions deployed before the data migrations keep sending. They log
loudly when they use the fallback.

---

## 2. Hosting

```powershell
npm run build-deploy-prod
```

---

## 3. Pin the code-owned template ids

Must run before anything renames a template.

```bash
node scripts/pin-template-ids.js --project=prod
node scripts/pin-template-ids.js --project=prod --execute
```

Copies `Sales Receipt` and `Amazon Shipping Confirmation` to
`tmpl-sales-receipt` / `tmpl-amazon-shipping-confirmation`, **verifies the copy
reads back identical, and only then deletes the original.** A half-done run
leaves two documents (the send path prefers the pinned id) rather than none.

---

## 4. Give every template a home

```bash
node scripts/move-template-home.js --project=prod --name="Healthy Marriage Videos" --kind=product --editor="Store Manager > Products > Send Follow Up Email > Select Email" --execute
node scripts/move-template-home.js --project=prod --name="Sales Receipt" --kind=store --editor="Store Manager > Products > Order Receipt" --execute
node scripts/move-template-home.js --project=prod --name="Disciple-Making Church Seminar Receipt" --kind=event --editor="Events Manager > Events > Info > Email Template" --execute
node scripts/move-template-home.js --project=prod --name="Summit Registration 2027" --kind=summit --editor="Events Manager > Summit > Info > Email Template" --execute
node scripts/move-template-home.js --project=prod --name="Summit Registration Success Template" --kind=summit --editor="Events Manager > Summit > Info > Email Template" --execute
```

> **Order note.** Do this AFTER hosting (step 2). The pickers filter by kind,
> so a template moved before the new code is live would vanish from a
> dropdown that does not yet know the kind exists.

---

## 5. The generic event confirmation

```bash
node scripts/seed-event-registration-template.js --project=prod --assign
node scripts/seed-event-registration-template.js --project=prod --assign --execute
```

Creates **Event Registration Confirmation** and repoints the 5 active
equipping groups off `Sales Receipt` plus the Ken Adams event that has none.
**Expect exactly 6 reassignments** — if the dry run says otherwise, stop.

Undo list: `scripts/output/event-template-reassign-impactdisciples-a82a8.json`.

---

## 6. Rename the 2026 summit template

```bash
node scripts/rename-template.js --project=prod --from="Summit Registration Success Template" --to="Summit Registration 2026" --execute
```

Repoints its event first, then renames — never the other way round. Then
**rename its backup file** to match the new slug, or `--revert` later will
look for a filename that no longer exists:

```bash
cd scripts/output
mv template-backup-summit-registration-success-template-impactdisciples-a82a8.json \
   template-backup-summit-registration-2026-impactdisciples-a82a8.json
cd ../..
```

---

## 7. Convert to builder templates

Dry-run each and read the "NOT verbatim" and "Left alone" sections — they list
every deliberate content change.

```bash
for n in "Amazon Shipping Confirmation" "Healthy Marriage Videos" "Sales Receipt" \
         "Disciple-Making Church Seminar Receipt" "Summit Registration 2027" \
         "Summit Registration 2026"; do
  node scripts/convert-template-to-builder.js --project=prod --name="$n" --execute
done
```

This is where both `[object Object]` links are fixed.

**Elevate Workshops is deliberately absent** — 953 KB, 90.9% of the 1 MiB doc
limit, cannot hold a design plus recompiled html. It is deleted in step 8.

---

## 8. Retire what is no longer used

Each reassigns references **before** deleting — the binding is by name, so
deleting first leaves events sending nothing, silently.

```bash
for n in "Seminar Template" "Whitewater Campus Receipt" \
         "Impact Disciple-Making Network" "Elevate Workshops Registration Success Template"; do
  node scripts/retire-template.js --project=prod --name="$n" \
    --reassign-to="Event Registration Confirmation" --execute
done
```

`Seminar Template` is an internal staff notification from the retired Seminar
Request form (23 sends, **all to info@impactdisciples.com**, last 2026-02-03),
mis-wired to 3 events. Its siblings — Consultation Survey, Lunch And Learn —
were already deleted.

---

## 9. Verify

```bash
node scripts/probe-system-templates.js --project=prod
```

Expected end state — **7 templates, all BUILDER, System Templates empty:**

```
event        Disciple-Making Church Seminar Receipt
event        Event Registration Confirmation
fulfillment  Amazon Shipping Confirmation   (tmpl-amazon-shipping-confirmation)
product      Healthy Marriage Videos
store        Sales Receipt                  (tmpl-sales-receipt)
summit       Summit Registration 2026
summit       Summit Registration 2027
```

Then the three checks that actually matter:

```bash
# 1. nothing names a template that does not exist  -> must be 0
# 2. no [object Object] left in any template        -> must be 0
# 3. no template still lacks a design               -> must be 0
```

And in the UI: Store Manager → Products → **Order Receipt** opens the
designer; an event's **Email Template** pencil opens the designer and Back
says "Back to Events"; the variable menu on an event offers EVENT_NAME and
**not** TRACKING.

Finally, send yourself a test from the designer's **Send test** on at least
Sales Receipt and one event confirmation.

---

## If something goes wrong

| step | undo |
|---|---|
| 3 pin ids | `scripts/output/template-pinned-*.json` holds the full document; the copy is verified before the original is deleted |
| 4 move home | `move-template-home.js --revert --execute` (deletes the `kind` field) |
| 5 seed | `event-template-reassign-*.json` lists every event and its previous template |
| 6 rename | `template-rename-*.json`; re-run with `--from`/`--to` swapped |
| 7 convert | `convert-template-to-builder.js --revert --execute` — restores the html and DELETES `design`, so the doc returns to exactly its previous shape |
| 8 retire | `template-retired-*.json` holds the whole document plus the events that pointed at it |

**Functions can be rolled back independently of data.** Every lookup falls
back to the name, so redeploying the previous functions build against migrated
data still sends.

The one genuinely irreversible thing is step 8's deletes — which is why each
writes the full document to `scripts/output/` first, and why that directory
should not be cleared until you are satisfied.

---

## Known-and-accepted, not bugs to chase

- **Summit Registration 2027** hardcodes *"seeing you in February!"*. Left as a
  copy decision; `{{startDate}}` carries the real date immediately above it.
- **Disciple-Making Church Seminar Receipt has no merge tags at all** — it
  cannot greet the registrant or name their event. Adding one is a copy
  decision, not a conversion.
- `renderPlaceholders` now has **no production callers**. Kept with its tests
  as the reference statement of the single-pass rule.
