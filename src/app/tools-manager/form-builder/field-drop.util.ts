import { moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { createFieldDef, FormFieldDef, FormFieldType } from '@impact-common/shared/models/domain/form-field.model';

export const PALETTE_PREFIX = 'palette-';
export const COLUMN_PREFIX = 'column-';

// The minimal shape this handler actually needs, rather than the real
// CdkDragDrop<T> - every drop list in the builder binds a differently-typed
// [cdkDropListData] (FormFieldDef[] for canvas/column, FormFieldType[] for
// palette), and CdkDragDrop<T>'s own EventEmitter<T> field makes it
// contravariant in T, so no single CdkDragDrop<...> parameter type (a union,
// `unknown`, or `any`) can accept every call site - a plain structural
// interface sidesteps that entirely since assigning a concrete
// CdkDragDrop<FormFieldType[]> value into this narrower shape is an
// ordinary (non-excess-property-checked) widening, not a contravariant
// function-parameter match.
export interface FieldDropEvent {
  previousContainer: { id: string; data: unknown };
  container: { id: string; data: unknown };
  previousIndex: number;
  currentIndex: number;
}

// Shared (cdkDropListDropped) handler for every drop target in the builder
// canvas (the top-level list and every 'columns' field's two nested lists) -
// a plain function rather than a component method so it's called identically
// from the top-level canvas list and from each recursively-rendered column
// list (see form-builder.component.html's #fieldCard template) without
// needing to bubble CDK's drop event up through a component boundary.
//
// Both source and destination lists bind [cdkDropListData] to either a
// FormFieldDef[] (canvas/column) or a FormFieldType[] (palette group) - see
// form-builder.component.ts's fieldTypesForGroup(). A palette source is
// never mutated (dropping from the palette copies a brand-new field in via
// createFieldDef(), it never removes the palette's own array entry) -
// that's what makes the palette "drag to copy" rather than "drag to move".
export function handleFieldDrop(event: FieldDropEvent): void {
  const fromPalette = event.previousContainer.id.startsWith(PALETTE_PREFIX);

  // A 'columns' field dropped into a column list would need column-inside-
  // column rendering/drag-drop this builder doesn't offer - block it here
  // rather than let it silently corrupt into an unrenderable state.
  if (fromPalette && event.container.id.startsWith(COLUMN_PREFIX)) {
    const draggedType = (event.previousContainer.data as FormFieldType[])[event.previousIndex];
    if (draggedType === 'columns') {
      return;
    }
  }

  if (event.previousContainer === event.container) {
    moveItemInArray(event.container.data as FormFieldDef[], event.previousIndex, event.currentIndex);
    return;
  }

  if (fromPalette) {
    const type = (event.previousContainer.data as FormFieldType[])[event.previousIndex];
    (event.container.data as FormFieldDef[]).splice(event.currentIndex, 0, createFieldDef(type));
    return;
  }

  transferArrayItem(event.previousContainer.data as FormFieldDef[], event.container.data as FormFieldDef[], event.previousIndex, event.currentIndex);
}
