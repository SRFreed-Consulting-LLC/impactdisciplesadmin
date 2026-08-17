import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  EmailBlock,
  EmailColumn,
  EmailDesign,
  EmailRow,
  EmailSection,
  createDefaultDesign
} from 'src/app/common/models/admin/email-design.model';

export type SelectionKind = 'block' | 'row' | 'section';

export interface DesignerSelection {
  kind: SelectionKind;
  id: string;
}

export type DesignerViewMode = 'desktop' | 'mobile';

// Per-editor-instance state holder - provided by EmailDesignerComponent's
// `providers`, NOT root, so every visit to the designer starts fresh.
//
// Mutation model: every canvas/panel change goes through commit(), which
// snapshots the design JSON onto the undo stack first. The design object is
// mutated in place (the canvas renders directly off the same tree the drag-
// drop handlers splice into, same as the form builder), so undo/redo works
// by wholesale JSON restore rather than structural sharing - simple, and a
// full design is only tens of KB.
@Injectable()
export class DesignerStateService {
  design: EmailDesign = createDefaultDesign();
  viewMode: DesignerViewMode = 'desktop';
  dirty = false;
  // True while an inline Quill editor owns the keyboard - the shell's
  // Ctrl+Z/Ctrl+Y handlers stand down so Quill's own history applies while
  // typing; our snapshot lands when the editor deactivates.
  inlineEditing = false;
  // Only one live Quill instance at a time (Mailchimp's click-to-edit
  // model): the id of the text/heading block currently swapped to an
  // editor, or null when every block renders as static HTML.
  editingBlockId: string | null = null;

  selection$ = new BehaviorSubject<DesignerSelection | null>(null);
  // Bumped on every commit/undo/redo - lets components that cache derived
  // structures (e.g. the canvas's connected drop-list id array) recompute.
  revision$ = new BehaviorSubject<number>(0);

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private static readonly MAX_HISTORY = 50;

  load(design: EmailDesign): void {
    this.design = design;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.selection$.next(null);
    this.bump();
  }

  // Wraps a mutation of `design`: pushes an undo snapshot, applies the
  // mutator, marks dirty. Text typing should NOT call this per keystroke -
  // the inline editor commits once when it deactivates.
  commit(mutate: (design: EmailDesign) => void): void {
    this.undoStack.push(JSON.stringify(this.design));
    if (this.undoStack.length > DesignerStateService.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    mutate(this.design);
    this.dirty = true;
    this.bump();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (snapshot === undefined) {
      return;
    }
    this.redoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(snapshot);
    this.dirty = true;
    this.selection$.next(null);
    this.bump();
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (snapshot === undefined) {
      return;
    }
    this.undoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(snapshot);
    this.dirty = true;
    this.selection$.next(null);
    this.bump();
  }

  select(kind: SelectionKind, id: string): void {
    this.selection$.next({ kind, id });
  }

  deselect(): void {
    this.selection$.next(null);
  }

  isSelected(kind: SelectionKind, id: string): boolean {
    const selection = this.selection$.value;
    return !!selection && selection.kind === kind && selection.id === id;
  }

  // ---------------------------------------------------------------- lookups

  findBlock(id: string): { block: EmailBlock; column: EmailColumn; row: EmailRow; section: EmailSection } | null {
    for (const section of this.design.sections) {
      for (const row of section.rows) {
        for (const column of row.columns) {
          const block = column.blocks.find((candidate) => candidate.id === id);
          if (block) {
            return { block, column, row, section };
          }
        }
      }
    }
    return null;
  }

  findRow(id: string): { row: EmailRow; section: EmailSection } | null {
    for (const section of this.design.sections) {
      const row = section.rows.find((candidate) => candidate.id === id);
      if (row) {
        return { row, section };
      }
    }
    return null;
  }

  findSection(id: string): EmailSection | null {
    return this.design.sections.find((section) => section.id === id) ?? null;
  }

  // ---------------------------------------------------------- drop wiring

  // Connected drop-list ids, recomputed from the live design tree. Cheap
  // (a handful of strings) so callable straight from templates.
  columnDropIds(): string[] {
    const ids: string[] = [];
    for (const section of this.design.sections) {
      for (const row of section.rows) {
        for (const column of row.columns) {
          ids.push('col-' + column.id);
        }
      }
    }
    return ids;
  }

  rowDropIds(): string[] {
    return this.design.sections.map((section) => 'rows-' + section.id);
  }

  private bump(): void {
    this.revision$.next(this.revision$.value + 1);
  }
}
