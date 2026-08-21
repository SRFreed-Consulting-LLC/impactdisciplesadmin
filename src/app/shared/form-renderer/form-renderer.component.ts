import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { controlStyleVars, FormControlStyle, FormFieldDef } from '@impact-common/shared/models/domain/form-field.model';
import { buildFormGroup } from './build-form-group';

// Renders a fields[] tree as an actual reactive form - used both for the
// Form Builder's own Live Preview (mode 'preview', disabled - nothing is
// ever submitted from there) and its "Preview & Test Submit" action (mode
// 'fill', real validators applied, (submitted) emits the raw values). Written
// to depend on nothing beyond FormFieldDef + this app's own shared field
// components, so it could plausibly be lifted into the public site later
// (out of scope for this pass) without dragging along admin-only code.
@Component({
    selector: 'app-form-renderer',
    templateUrl: './form-renderer.component.html',
    styleUrls: ['./form-renderer.component.scss'],
    standalone: false
})
export class FormRendererComponent implements OnChanges {
  @Input() fields: FormFieldDef[] = [];
  @Input() mode: 'preview' | 'fill' = 'preview';
  // Whole-form background - see FormDefinitionModel.backgroundColor's own comment.
  @Input() backgroundColor?: string;
  // Default input-chrome styling for every field - see FormControlStyle's
  // own comment. Applied as CSS custom properties on this component's own
  // wrapper; each field's own FormRendererFieldComponent applies its
  // controlStyle the same way on ITS wrapper, which (via ordinary CSS
  // custom property inheritance) overrides just that field's subtree.
  @Input() controlStyle?: FormControlStyle;
  @Output() submitted = new EventEmitter<Record<string, unknown>>();

  form: FormGroup = new FormGroup({});

  get controlStyleVars(): Record<string, string> {
    return controlStyleVars(this.controlStyle);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['fields'] || changes['mode']) {
      this.form = buildFormGroup(this.fields ?? [], this.mode === 'fill');
      if (this.mode === 'preview') {
        this.form.disable({ emitEvent: false });
      }
    }
  }

  submit(): void {
    if (this.mode !== 'fill') {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitted.emit(this.form.getRawValue());
  }
}
