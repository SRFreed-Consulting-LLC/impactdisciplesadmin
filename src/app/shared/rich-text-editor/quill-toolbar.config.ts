import { QuillModules } from 'ngx-quill';
import { RICH_TEXT_PASTE_MATCHERS } from './quill-paste-cleanup';

// Toolbar approximating the original dx-html-editor toolbar used across Web
// Config, DMM Service, and the newsletter/prayer-request "send" screens.
// Quill has no built-in table support (that needs a separate plugin like
// quill-better-table), so insert/edit-table buttons are dropped - the one
// real capability loss flagged when ngx-quill was chosen over dx-html-editor.
// Undo/redo also has no default toolbar button in Quill (only the
// Ctrl+Z/Ctrl+Y keyboard shortcuts, via its built-in history module).
//
// IT CARRIES THE PASTE CLEANUP TOO (2026-09-04), which is why this is the
// thing every editor imports rather than each one assembling its own modules
// object. Copy pasted from a rendered page brings that page's ink with it -
// `background-color: rgb(255, 255, 255); color: rgb(34, 34, 34)`, sixteen
// times over in the case that prompted this - which overrides the surface a
// section is drawn on. A cleanup is only worth anything if it is impossible
// to leave off a new editor, so it travels with the toolbar rather than being
// a second import to remember. See quill-paste-cleanup.ts for what it drops
// and why, and quill-semantic-html.ts for the separate, larger half of that
// incident, which paste had nothing to do with.
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
  ],
  clipboard: { matchers: RICH_TEXT_PASTE_MATCHERS }
};
