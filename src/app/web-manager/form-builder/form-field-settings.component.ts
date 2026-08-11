import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { BehaviorSubject, Subscription } from 'rxjs';
import {
  FIELD_TYPE_META,
  FormFieldDef,
  FormFieldStyle,
  setColumnCount,
  supportsLabelDisplay
} from 'src/app/common/models/domain/form-field.model';
import { ImageModel } from 'src/app/common/models/utils/image.model';

// Settings drawer for whichever field is selected in the Form Builder
// canvas - edits apply live, mutating the field object in place (same
// "mutate in place, no round trip" pattern events.component.ts already uses
// for its nested tab data); FormBuilderComponent's own Save button is what
// actually persists. Its own file/component rather than inline in
// FormBuilderComponent because the options-list editor (checkboxes/radio/
// dropdown) and the Style section are substantial enough to warrant
// separating out.
@Component({
    selector: 'app-form-field-settings',
    templateUrl: './form-field-settings.component.html',
    styleUrls: ['./form-field-settings.component.scss'],
    standalone: false
})
export class FormFieldSettingsComponent implements OnChanges {
  @Input() field: FormFieldDef;
  @Output() closed = new EventEmitter<void>();

  form: FormGroup;

  // Backs app-image-uploader's [card]/[field] inputs directly, same pattern
  // as HomePageImageDialogComponent - the uploader writes the picked file's
  // URL onto this object, closeImageUploader() below copies it into the
  // form (imageUrl always ends up a plain string either way, whether the
  // admin typed/pasted a URL directly or picked one from the library).
  imageCard: { image?: ImageModel } = {};
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  readonly fontSizes: { value: string; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
    { value: 'x-large', label: 'Extra Large' }
  ];

  readonly fontFamilies: { value: string; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'serif', label: 'Serif' },
    { value: 'sans-serif', label: 'Sans Serif' },
    { value: 'monospace', label: 'Monospace' }
  ];

  readonly imageWidths: { value: string; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
    { value: 'full', label: 'Full Width' }
  ];

  readonly columnCountOptions = [2, 3, 4];

  private sub?: Subscription;

  constructor(private fb: FormBuilder) {}

  get meta() {
    return FIELD_TYPE_META[this.field.type];
  }

  get hasOptions(): boolean {
    return this.field.type === 'checkboxes' || this.field.type === 'radio' || this.field.type === 'dropdown';
  }

  // Label/placeholder/required apply to every real data field - not to the
  // structural layout types (heading/instructions/image/divider/columns),
  // each of which has its own minimal settings shown separately below.
  get isDataField(): boolean {
    return !this.meta.isLayout;
  }

  get showLabelDisplay(): boolean {
    return supportsLabelDisplay(this.field.type);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['field']) {
      this.sub?.unsubscribe();
      this.imageCard = { image: this.field.imageUrl ? { name: this.field.imageAlt || 'image', url: this.field.imageUrl } : undefined };

      this.form = this.fb.group({
        label: [this.field.label],
        placeholder: [this.field.placeholder ?? ''],
        required: [!!this.field.required],
        html: [this.field.html ?? ''],
        labelDisplay: [this.field.labelDisplay ?? 'label'],
        textColor: [this.field.style?.textColor ?? ''],
        fontSize: [this.field.style?.fontSize ?? 'medium'],
        fontFamily: [this.field.style?.fontFamily ?? 'default'],
        align: [this.field.style?.align ?? 'left'],
        bold: [!!this.field.style?.bold],
        italic: [!!this.field.style?.italic],
        imageUrl: [this.field.imageUrl ?? ''],
        imageAlt: [this.field.imageAlt ?? ''],
        imageWidth: [this.field.imageWidth ?? 'medium']
      });

      this.sub = this.form.valueChanges.subscribe((value) => {
        // Never assign a literal `undefined` here (as opposed to just
        // omitting the key) - Firestore's addDoc()/setDoc() reject any
        // field whose value is undefined, anywhere in a nested object, not
        // just at the top level. An empty string is a harmless stand-in:
        // FormRendererFieldComponent already only shows a placeholder when
        // one is actually set.
        this.field.label = value.label;
        this.field.placeholder = value.placeholder ?? '';
        this.field.required = value.required;
        this.field.html = value.html ?? '';
        this.field.labelDisplay = value.labelDisplay;
        // Omit textColor entirely rather than assigning it `undefined` when
        // blank - see the comment above on why a literal undefined anywhere
        // in this object would break the eventual Firestore write.
        const style: FormFieldStyle = {
          fontSize: value.fontSize,
          fontFamily: value.fontFamily,
          align: value.align,
          bold: value.bold,
          italic: value.italic
        };
        if (value.textColor) {
          style.textColor = value.textColor;
        }
        this.field.style = style;
        this.field.imageUrl = value.imageUrl ?? '';
        this.field.imageAlt = value.imageAlt ?? '';
        this.field.imageWidth = value.imageWidth;
      });
    }
  }

  // Options intentionally keep label === value (no separate internal-id
  // editor) - a form builder is authored fresh far more often than an
  // option is renamed after real submissions exist, and a hidden stale
  // "value" a renamed label no longer matches is a worse footgun than that.
  addOption(): void {
    const options = this.field.options ?? [];
    const label = `Option ${options.length + 1}`;
    this.field.options = [...options, { label, value: label }];
  }

  updateOptionLabel(index: number, label: string): void {
    const options = this.field.options ?? [];
    this.field.options = options.map((o, i) => (i === index ? { label, value: label } : o));
  }

  removeOption(index: number): void {
    this.field.options = (this.field.options ?? []).filter((_, i) => i !== index);
  }

  setColumns(count: number): void {
    setColumnCount(this.field, count);
  }

  showImageUploader(): void {
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    this.isImageUploaderVisible$.next(false);
    if (this.imageCard.image?.url) {
      this.form.get('imageUrl')?.setValue(this.imageCard.image.url);
      if (!this.form.get('imageAlt')?.value) {
        this.form.get('imageAlt')?.setValue(this.imageCard.image.name ?? '');
      }
    }
  }
}
