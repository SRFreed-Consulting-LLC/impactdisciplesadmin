import { QuillModules } from 'ngx-quill';

// Toolbar approximating the original dx-html-editor toolbar used across Web
// Config, DMM Service, and the newsletter/prayer-request "send" screens.
// Quill has no built-in table support (that needs a separate plugin like
// quill-better-table), so insert/edit-table buttons are dropped - the one
// real capability loss flagged when ngx-quill was chosen over dx-html-editor.
// Undo/redo also has no default toolbar button in Quill (only the
// Ctrl+Z/Ctrl+Y keyboard shortcuts, via its built-in history module).
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
