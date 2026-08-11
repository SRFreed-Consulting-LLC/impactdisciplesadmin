import { Component, Input } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { FIELD_TYPE_META, FormFieldDef, IMAGE_WIDTH_CSS, fieldStyleObject } from 'src/app/common/models/domain/form-field.model';

// Renders exactly one FormFieldDef against the shared top-level FormGroup a
// parent app-form-renderer built (see build-form-group.ts) - dispatches by
// field.type, including recursing into itself for a 'columns' field's two
// nested arrays (a field inside a column is just another FormFieldDef).
@Component({
    selector: 'app-form-renderer-field',
    templateUrl: './form-renderer-field.component.html',
    styleUrls: ['./form-renderer-field.component.scss'],
    standalone: false
})
export class FormRendererFieldComponent {
  @Input() field: FormFieldDef;
  @Input() form: FormGroup;
  @Input() mode: 'preview' | 'fill' = 'preview';

  readonly stars = [1, 2, 3, 4, 5];

  get meta() {
    return FIELD_TYPE_META[this.field.type];
  }

  // [ngStyle]-ready style object from the field's own overrides - applied
  // to every case's wrapper (data fields: affects the label; content
  // blocks: affects the whole block). See fieldStyleObject's own comment.
  get styleObject(): Record<string, string> {
    return fieldStyleObject(this.field.style);
  }

  get imageWidthCss(): string {
    return IMAGE_WIDTH_CSS[this.field.imageWidth ?? 'medium'];
  }

  get usesPlaceholder(): boolean {
    return this.field.labelDisplay === 'placeholder';
  }

  get placeholderText(): string {
    return this.field.placeholder || this.field.label;
  }

  control(): FormControl {
    return this.form.get(this.field.id) as FormControl;
  }

  group(): FormGroup {
    return this.form.get(this.field.id) as FormGroup;
  }

  hasError(errorCode: string): boolean {
    const control = this.control();
    return !!control && control.touched && control.hasError(errorCode);
  }

  isChecked(value: string): boolean {
    const current = (this.control()?.value as string[]) ?? [];
    return current.includes(value);
  }

  toggleOption(value: string, checked: boolean): void {
    const control = this.control();
    if (!control) {
      return;
    }
    const current = (control.value as string[]) ?? [];
    control.setValue(checked ? [...current, value] : current.filter((v) => v !== value));
  }

  ratingValue(): number {
    return Number(this.control()?.value) || 0;
  }

  setRating(value: number): void {
    if (this.mode !== 'fill') {
      return;
    }
    this.control()?.setValue(value);
  }
}
