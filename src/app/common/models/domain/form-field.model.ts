// Single registry for the Form Builder feature (Web Manager > Form Builder,
// Requests Manager > Custom Form Submissions) - the palette, the canvas, the
// settings panel, and the renderer all read from FIELD_TYPE_META instead of
// each hardcoding their own copy of "what field types exist and what group
// they're in". Same "one source of truth" principle NAV_CONFIG already uses
// for nav + permissions (see core/main-screen/nav-config.ts).
//
// Deliberately not built on/against Form.io or any third-party form-runtime
// library - see the Web Manager tool-comparison mockups this followed. Not
// included, on purpose: Signature (canvas capture), File Upload (would need
// a new public-safe Storage upload path - the existing ImageUploaderComponent
// is an internal admin file-browser with folder/move/rename capability, the
// wrong tool to hand to a public form filler), repeating/Data Grid sections,
// and Tabs/page breaks. All can be added later the same way any entry below
// was: a new FormFieldType, a FIELD_TYPE_META row, and a case in
// form-renderer-field.component.ts.
export type FormFieldType =
  | 'text'
  | 'paragraph'
  | 'number'
  | 'checkbox'
  | 'checkboxes'
  | 'radio'
  | 'dropdown'
  | 'email'
  | 'phone'
  | 'address'
  | 'date'
  | 'time'
  | 'datetime'
  | 'url'
  | 'rating'
  | 'heading'
  | 'instructions'
  | 'image'
  | 'divider'
  | 'columns';

export interface FormFieldOption {
  label: string;
  value: string;
}

// Text-style attributes offered on every field type (data fields render
// them on their label; content blocks - heading/instructions/image - render
// them on the whole block). A plain nested object rather than flattening
// these onto FormFieldDef itself, so "does this field have any style
// overrides at all" is one `!!field.style` check rather than N individual
// ones.
export type FieldFontSize = 'small' | 'medium' | 'large' | 'x-large';
export type FieldFontFamily = 'default' | 'serif' | 'sans-serif' | 'monospace';
export type FieldAlign = 'left' | 'center' | 'right';

export interface FormFieldStyle {
  textColor?: string; // hex, e.g. #1a2b3c
  fontSize?: FieldFontSize;
  fontFamily?: FieldFontFamily;
  align?: FieldAlign;
  bold?: boolean;
  italic?: boolean;
}

// Whether a text-box-style data field (text/paragraph/number/email/url)
// shows its label above the control (the default, matching every other
// screen in this app) or uses the label text as the control's placeholder
// instead, with no visible label. Only offered for that "single box" family
// of types - see form-field-settings.component.html's own gating - a
// dropdown/checkbox/radio/date/etc's label isn't a natural placeholder.
export type LabelDisplay = 'label' | 'placeholder';

export type ImageWidth = 'small' | 'medium' | 'large' | 'full';

// One column of a 'columns' field. Wrapped in an object (rather than
// FormFieldDef being directly `columns: FormFieldDef[][]`) because Firestore
// rejects an array whose elements are themselves arrays ("Nested arrays are
// not supported") - live-diagnosed via addDoc() throwing exactly that on the
// original FormFieldDef[][] shape. An array of {fields} objects, each with
// its own single-level array, sidesteps the restriction entirely.
export interface FormFieldColumn {
  fields: FormFieldDef[];
}

export interface FormFieldDef {
  // Stable per-field id (crypto.randomUUID()) - used as the submission's
  // value key, the canvas drag trackBy, and the settings panel's selection
  // key. Never reused/regenerated once a field is created, including across
  // edits, so a published form's past submissions stay keyed correctly.
  id: string;
  type: FormFieldType;
  // Field label. Doubles as the internal admin-facing name for 'heading'
  // (the heading text itself) and 'divider' (an admin note, never rendered).
  label: string;
  placeholder?: string;
  required?: boolean;
  // 'checkboxes' | 'radio' | 'dropdown' only.
  options?: FormFieldOption[];
  // 'instructions' only - rich text via the app's existing ngx-quill.
  html?: string;
  // 'image' only. imageUrl is always a plain resolved URL regardless of how
  // the admin got it - the settings panel offers both "paste a URL" and an
  // "Upload Image" button (the app's own ImageUploaderComponent/Storage
  // library), the latter just writes its picked file's URL in here too.
  imageUrl?: string;
  imageAlt?: string;
  imageWidth?: ImageWidth;
  // Every field type - see FormFieldStyle's own comment.
  style?: FormFieldStyle;
  // text/paragraph/number/email/url only - see LabelDisplay's own comment.
  labelDisplay?: LabelDisplay;
  // 'columns' only - 2 or more entries, one per column (admin-adjustable via
  // the settings panel's Number of Columns control). Recursive: a field
  // inside a column is just another FormFieldDef (though nesting a second
  // 'columns' inside a column is not offered in the palette).
  columns?: FormFieldColumn[];
}

export interface FieldTypeMeta {
  label: string;
  icon: string; // mat-icon ligature name
  group: 'Basic' | 'Advanced' | 'Layout';
  // True for structural elements with no submitted value of their own
  // (heading/instructions/divider/columns) - the renderer skips these when
  // building the submission's FormGroup/values.
  isLayout: boolean;
}

export const FIELD_TYPE_META: Record<FormFieldType, FieldTypeMeta> = {
  text: { label: 'Text', icon: 'short_text', group: 'Basic', isLayout: false },
  paragraph: { label: 'Paragraph', icon: 'notes', group: 'Basic', isLayout: false },
  number: { label: 'Number', icon: 'numbers', group: 'Basic', isLayout: false },
  checkbox: { label: 'Checkbox', icon: 'check_box', group: 'Basic', isLayout: false },
  checkboxes: { label: 'Checkboxes', icon: 'checklist', group: 'Basic', isLayout: false },
  radio: { label: 'Radio Group', icon: 'radio_button_checked', group: 'Basic', isLayout: false },
  dropdown: { label: 'Dropdown', icon: 'arrow_drop_down_circle', group: 'Basic', isLayout: false },

  email: { label: 'Email', icon: 'alternate_email', group: 'Advanced', isLayout: false },
  phone: { label: 'Phone', icon: 'call', group: 'Advanced', isLayout: false },
  address: { label: 'Address', icon: 'home', group: 'Advanced', isLayout: false },
  date: { label: 'Date', icon: 'event', group: 'Advanced', isLayout: false },
  time: { label: 'Time', icon: 'schedule', group: 'Advanced', isLayout: false },
  datetime: { label: 'Date & Time', icon: 'event_available', group: 'Advanced', isLayout: false },
  url: { label: 'Website', icon: 'link', group: 'Advanced', isLayout: false },
  rating: { label: 'Rating', icon: 'star', group: 'Advanced', isLayout: false },

  heading: { label: 'Section Heading', icon: 'title', group: 'Layout', isLayout: true },
  instructions: { label: 'Content', icon: 'article', group: 'Layout', isLayout: true },
  image: { label: 'Image', icon: 'image', group: 'Layout', isLayout: true },
  divider: { label: 'Divider', icon: 'horizontal_rule', group: 'Layout', isLayout: true },
  columns: { label: 'Columns', icon: 'view_column', group: 'Layout', isLayout: true }
};

// CSS values behind each style preset - kept out of the renderer/settings
// panel so both read the exact same mapping.
export const FONT_SIZE_CSS: Record<FieldFontSize, string> = {
  small: '13px',
  medium: '15px',
  large: '19px',
  'x-large': '24px'
};

export const FONT_FAMILY_CSS: Record<FieldFontFamily, string> = {
  default: '',
  serif: 'Georgia, "Times New Roman", serif',
  'sans-serif': 'Arial, Helvetica, sans-serif',
  monospace: '"Courier New", Courier, monospace'
};

export const IMAGE_WIDTH_CSS: Record<ImageWidth, string> = {
  small: '200px',
  medium: '400px',
  large: '600px',
  full: '100%'
};

// Builds an [ngStyle]-ready object from a field's style overrides - shared
// by every content-rendering case in form-renderer-field.component.html
// (heading/instructions/image) and applied to a data field's own wrapper
// (affects its label; a Material field's own internals aren't always
// themeable via plain inherited CSS, a known v1 limitation).
export function fieldStyleObject(style?: FormFieldStyle): Record<string, string> {
  if (!style) {
    return {};
  }
  const out: Record<string, string> = {};
  if (style.textColor) {
    out['color'] = style.textColor;
  }
  if (style.fontSize) {
    out['font-size'] = FONT_SIZE_CSS[style.fontSize];
  }
  if (style.fontFamily && style.fontFamily !== 'default') {
    out['font-family'] = FONT_FAMILY_CSS[style.fontFamily];
  }
  if (style.align) {
    out['text-align'] = style.align;
  }
  if (style.bold) {
    out['font-weight'] = 'bold';
  }
  if (style.italic) {
    out['font-style'] = 'italic';
  }
  return out;
}

// text/paragraph/number/email/url only - the "single text box" family the
// Label/Placeholder toggle applies to. See LabelDisplay's own comment.
const LABEL_DISPLAY_TYPES: FormFieldType[] = ['text', 'paragraph', 'number', 'email', 'url'];

export function supportsLabelDisplay(type: FormFieldType): boolean {
  return LABEL_DISPLAY_TYPES.includes(type);
}

// Palette groups, in display order - the order palette entries fall out of
// FIELD_TYPE_META for a given group is insertion order (a plain object),
// this just fixes the group order itself (Basic, then Advanced, then Layout).
export const FIELD_TYPE_GROUPS: ('Basic' | 'Advanced' | 'Layout')[] = ['Basic', 'Advanced', 'Layout'];

export function fieldTypesInGroup(group: 'Basic' | 'Advanced' | 'Layout'): FormFieldType[] {
  return (Object.keys(FIELD_TYPE_META) as FormFieldType[]).filter((type) => FIELD_TYPE_META[type].group === group);
}

// Choice-type fields (checkboxes/radio/dropdown) start with two placeholder
// options so a freshly-dropped field is immediately useful rather than an
// empty, unusable control.
const DEFAULT_OPTIONS: FormFieldOption[] = [
  { label: 'Option 1', value: 'option-1' },
  { label: 'Option 2', value: 'option-2' }
];

// Builds a fresh FormFieldDef for a palette drop - the one place that knows
// each type's sensible defaults, so the canvas drop handler and any future
// "duplicate field" action share the same construction logic.
export function createFieldDef(type: FormFieldType): FormFieldDef {
  const meta = FIELD_TYPE_META[type];
  const field: FormFieldDef = {
    id: crypto.randomUUID(),
    type,
    label: meta.label,
    required: false
  };
  if (type === 'checkboxes' || type === 'radio' || type === 'dropdown') {
    field.options = DEFAULT_OPTIONS.map((o) => ({ ...o }));
  }
  if (type === 'instructions') {
    field.html = '';
  }
  if (type === 'image') {
    field.imageUrl = '';
    field.imageAlt = '';
    field.imageWidth = 'medium';
  }
  if (type === 'columns') {
    field.columns = [{ fields: [] }, { fields: [] }];
  }
  return field;
}

// Grows or shrinks a 'columns' field to exactly `count` columns, preserving
// every field already placed - shrinking merges the removed columns' fields
// onto the end of the last remaining column rather than discarding them, so
// changing your mind about column count is never destructive.
export function setColumnCount(field: FormFieldDef, count: number): void {
  const current = field.columns ?? [];
  if (count === current.length) {
    return;
  }
  if (count > current.length) {
    const additional: FormFieldColumn[] = Array.from({ length: count - current.length }, () => ({ fields: [] }));
    field.columns = [...current, ...additional];
    return;
  }
  const kept = current.slice(0, count).map((column) => ({ fields: [...column.fields] }));
  const overflow = current.slice(count).flatMap((column) => column.fields);
  kept[kept.length - 1].fields.push(...overflow);
  field.columns = kept;
}

// Flattens a fields[] tree into just its data-collecting fields (skipping
// heading/instructions/divider, and recursing into both of a 'columns'
// field's arrays rather than including the container itself) - the field
// list a submission's `values`/`fieldSnapshot` actually needs. Shared by the
// builder's "Preview & Test Submit" (building fieldSnapshot) and the Custom
// Form Submissions detail dialog (if it ever needs to re-derive from a live
// form rather than a stored snapshot).
export function flattenDataFields(fields: FormFieldDef[]): FormFieldDef[] {
  const result: FormFieldDef[] = [];
  for (const field of fields) {
    if (field.type === 'columns') {
      (field.columns ?? []).forEach((column) => result.push(...flattenDataFields(column.fields)));
      continue;
    }
    if (!FIELD_TYPE_META[field.type].isLayout) {
      result.push(field);
    }
  }
  return result;
}

// Label/value formatter for a submitted value - shared by the builder's
// live preview summary (none needed there today) and the Custom Form
// Submissions detail dialog, so that dialog stays simple presentation with
// no per-type branching of its own.
export function formatFieldValue(type: FormFieldType, value: unknown): string {
  if (value == null || value === '') {
    return '—';
  }
  if (type === 'address' && typeof value === 'object') {
    const a = value as Record<string, string>;
    return [a['address1'], a['address2'], [a['city'], a['state']].filter(Boolean).join(', '), a['zip']].filter(Boolean).join(', ');
  }
  if (type === 'phone' && typeof value === 'object') {
    const p = value as Record<string, string>;
    return [p['countryCode'], p['number']].filter(Boolean).join(' ') + (p['type'] ? ` (${p['type']})` : '');
  }
  if (type === 'checkboxes' && Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }
  if (type === 'rating') {
    return `${value} / 5`;
  }
  if (type === 'checkbox') {
    return value ? 'Yes' : 'No';
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  return String(value);
}
