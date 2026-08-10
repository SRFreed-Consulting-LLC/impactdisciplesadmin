import { Component, Input } from '@angular/core';
import { EventEmitter, Output } from '@angular/core';
import Quill from 'quill';

/**
 * Replaces dx-html-editor's built-in "variable" toolbar button + dxo-variables
 * datasource (used by Email Templates and the Customers "Send Email" dialog to
 * insert {{Recipient First Name}}-style placeholders). Quill has no equivalent
 * built-in, so this renders as a small menu button next to the quill-editor;
 * selecting an entry emits the raw variable name and the parent inserts it at
 * the current cursor position (see insertQuillVariable below).
 */
@Component({
    selector: 'app-variable-inserter',
    templateUrl: './variable-inserter.component.html',
    styleUrls: ['./variable-inserter.component.scss'],
    standalone: false
})
export class VariableInserterComponent {
  @Input() variables: string[] = [];
  @Output() insert = new EventEmitter<string>();
}

/**
 * Shared insertion logic: wraps the chosen variable name in the same
 * {{ }} escape characters dxo-variables used, and inserts it at the editor's
 * current cursor position (falling back to the end of the document if
 * nothing is focused/selected).
 */
export function insertQuillVariable(quill: Quill | undefined, variableName: string): void {
  if (!quill) {
    return;
  }
  const placeholder = '{{' + variableName + '}}';
  const range = quill.getSelection(true);
  const index = range ? range.index : quill.getLength();
  quill.insertText(index, placeholder, 'user');
  quill.setSelection(index + placeholder.length, 0, 'user');
}
