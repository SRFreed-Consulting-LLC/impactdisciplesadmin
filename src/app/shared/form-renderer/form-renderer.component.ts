import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { FormFieldDef } from 'src/app/common/models/domain/form-field.model';
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
  @Output() submitted = new EventEmitter<Record<string, unknown>>();

  form: FormGroup = new FormGroup({});

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
