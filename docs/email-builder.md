# Email Builder

> Split out of the admin repo's CLAUDE.md on 2026-08-26 to keep the
> always-loaded file small. Read this when working in `src/app/tools-manager/email-designer/`.

### Email Builder (`src/app/tools-manager/email-designer/`)

Full-screen, Mailchimp-style drag-drop email designer, lazy-loaded from tools-manager routing at
`/tools-manager/email-designer/new | :id`. Reached from Tools Manager > Email Templates ("New Email
Design" header action; row edit routes there when the template has a `design`); deliberately has NO
NavLeaf/screenKey of its own — it rides `tools-manager.email-templates` grants (checked in
`EmailDesignerComponent` after the first auth emission — a synchronous check bounced legitimate
direct-URL loads). Quill (the old 800px dialog) remains for "Rich Text" templates; the Editor column
on the list distinguishes them, and **presence of `MailTemplateModel.design` is the editor-type
flag**. Key pieces:

- **Design document**: `EmailDesign` (`src/app/common/models/admin/email-design.model.ts`) —
  sections (header/body/footer) → rows (1–4 columns) → typed blocks (heading/text/image/logo/button/
  divider/spacer/video/social/footer), each with desktop styles + sparse mobile overrides behind a
  `stylesLinked` toggle, plus email-wide `globalStyles` (desktop + mobile Partial). `null` for
  "unset", never `undefined` (see the Firestore write gotcha above; `stripUndefinedDeep()` in
  `src/app/common/utils/strip-undefined.ts` sweeps the save as belt-and-braces).
- **Compiler**: `src/app/common/utils/email/email-design-compiler.ts` — PURE TS (no Angular/DOM),
  design JSON → email-client-safe table HTML (600px, inline styles, MSO ghost tables for columns,
  one `@media` block for column stacking + unlinked mobile diffs). Mirrorable into `functions/` the
  same way `html-to-text.ts` is. On every save, `html` is recompiled from `design` — downstream
  consumers (campaign composer, send paths) only ever read `html` and needed zero changes.
- **Merge tags**: `src/app/common/utils/email/merge-tags.ts` — the ONE substitution engine.
  `*|FNAME|*`-style tags (incl. `*|TAG|fallback|*` inline defaults and `*|UNSUB|*` → caller-supplied
  unsubscribe URL), each absorbing the legacy `{{Recipient First Name}}`/`{{firstName}}` spellings,
  replacing ALL occurrences. The subscriber-blast and event-attendee-email dialogs were refactored
  onto it (their old chained `String.replace()` only hit the first occurrence); `EMailService`'s
  dead client-side template methods were removed at the same time. Functions-side substitution
  (`transactional-emails.ts`, `event-registration.functions.ts`) still uses its own `{{...}}`
  split/join — mirror `merge-tags.ts` into `functions/src/` before pointing a Cloud Function at
  builder-authored templates.
- **Editor internals**: per-instance `DesignerStateService` (commit-with-undo-snapshot mutations,
  cap 50, Ctrl+Z/Y suppressed while a Quill instance is live); CDK drag-drop adapted from the form
  builder's `field-drop.util.ts` (`block-drop.util.ts`); inline text editing is ngx-quill's BUBBLE
  theme (one live instance, swapped in on click-when-selected, output normalized through dompurify
  in `inline-editor/inline-html.util.ts`) — note the `styles.scss` global quill rules are
  deliberately overridden for `.inline-editor` (the global absolute-position layout collapses an
  auto-height editor to nothing). Image/logo/video-thumbnail picking reuses `app-image-uploader`.
  Video = linked thumbnail (YouTube via static `img.youtube.com` URLs, Vimeo via oEmbed —
  `HttpClientModule` is provided in this lazy module because the app has no global HttpClient).
  Preview renders the compiled HTML in a `sandbox="allow-same-origin"` (no scripts) iframe — the
  srcdoc SafeHtml is memoized, a per-CD-cycle getter made the iframe reload in a loop. Send Test
  goes through `EMailService.sendHtmlEmail` (the real `mail`-collection pipeline). E2E:
  `e2e/email-designer.spec.ts`.
