# Impact Disciples — Admin

Staff back-office for Impact Disciples: events/summits, contacts, store + fulfillment, web
content, campaigns, reports, tools, and the Library Manager (CMS for the patron Library Reader).
Angular 20 + Angular Material on Firebase (Firestore, Auth, Cloud Functions, Storage). This repo
also owns the suite's **Cloud Functions** (`functions/`) and the **one unified `firestore.rules`**
used by all three apps.

**Start here: [CLAUDE.md](CLAUDE.md)** — commands, architecture, conventions, the emulator-backed
test program, and the shared-submodule / functions-contract rules. `MIGRATION.md` is the running
log of data-shape gotchas and prod runbooks; `HANDOFF.md` is historical.

Quick commands:

```bash
npm install
npm run start-local -- --port=5200   # always 5200
npm run build-dev / build-prod
npm run test                          # Karma/Jasmine, headless
npm run lint
cd functions && npm run build && npm test && npm run lint
```

Sibling repos (checked out one directory up): `impactdisciples - web` (public site),
`impact-discipleship-library-new` (Library Reader). Shared code lives in the `src/common` git
submodule (`impact-discipleship-library-common`) — push it before pushing any app that bumps it.
