# Data scripts

Prod &lt;-&gt; Dev Firestore promotion tooling for this app's (default database)
data. See the plan this was built from for full context: back up Dev,
export Prod, import Prod's snapshot into Dev (fixing known data-quality
issues along the way), validate, then promote the validated result back to
Prod.

## Setup

These scripts use the Firebase Admin SDK (reused from `functions/`'s own
install - see `lib/firestore-admin.js`) authenticated via Application
Default Credentials, not a service account key checked into this repo:

```bash
gcloud auth application-default login
```

Run that once per machine before using anything here. There is no default
project - every script requires an explicit `--project=dev` or
`--project=prod` (or a literal project id) so a typo can't silently point a
script at the wrong environment.

## export.js

Read-only. Snapshots every collection (or a `--collections=a,b,c` subset) in
a project to JSON, one file per collection, under
`scripts/backups/<projectId>-<timestamp>/`.

```bash
npm run backup:dev                              # snapshot impactdisciplesdev
npm run backup:prod                             # snapshot impactdisciples-a82a8
node scripts/export.js --project=dev --collections=purchases,events
```

`scripts/backups/` is gitignored - these snapshots contain real customer PII
in both dev and prod, never commit them.

## Timestamp/GeoPoint/DocumentReference encoding

Plain `JSON.stringify` mangles Firestore's non-JSON-native types - see
`lib/firestore-json.js`. Every snapshot encodes them as
`{ "__datatype__": "timestamp" | "geopoint" | "documentReference", ... }` so
they round-trip exactly. If you ever need to hand-edit a snapshot file,
leave `__datatype__` fields alone.

## Convention for the scripts that write (import.js, promote.js, fix-date-shapes.js)

They exist (see the files above, plus the one-off backfill/migration scripts
alongside them and the executed one-offs under `scripts/archive/`) and follow
the same dry-run-by-default convention as the reader repo's `scripts/`: default to a
dry run that reports what *would* change, require an explicit flag
(`--execute`) to actually write, and tag every doc they touch so
promoted/imported data stays distinguishable from organically-created data.
