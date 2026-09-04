import { QuillModules } from 'ngx-quill';

// Toolbar approximating the original dx-html-editor toolbar used across Web
// Config, DMM Service, and the newsletter/prayer-request "send" screens.
// Quill has no built-in table support (that needs a separate plugin like
// quill-better-table), so insert/edit-table buttons are dropped - the one
// real capability loss flagged when ngx-quill was chosen over dx-html-editor.
// Undo/redo also has no default toolbar button in Quill (only the
// Ctrl+Z/Ctrl+Y keyboard shortcuts, via its built-in history module).
//
// A PASTE-CLEANUP MATCHER LIVED HERE FOR A DAY (2026-09-04) and is gone.
//
// It stripped the inline `color`/`background-color` that copy lifted from a
// rendered page carries, which is a real annoyance: it overrides the surface
// a section is drawn on. The matcher was still wrong, and the reason is worth
// keeping so nobody adds it back the same way.
//
// A CLIPBOARD MATCHER IS NOT A PASTE HOOK. ngx-quill's valueSetter loads a
// stored value with `quill.clipboard.convert()` - the very same path a paste
// takes - so the matcher ran every time an editor OPENED. A colour somebody
// chose deliberately from this toolbar was stripped on the next load and the
// next save persisted the loss. Quill gives a matcher no way to tell the two
// apart.
//
// Anything attempting this again has to hook the paste EVENT rather than the
// conversion, and has to answer what happens to colour the toolbar set on
// purpose. See quill-semantic-html.ts for the separate, larger half of that
// incident - the one that actually broke a page, and had nothing to do with
// pasting.
export const RICH_TEXT_TOOLBAR: QuillModules = {
  toolbar: [
    [{ header: [1, 2, 3, 4, 5, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ align: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote', 'code-block'],
    ['link', 'image'],
    ['clean']
  ]
};
