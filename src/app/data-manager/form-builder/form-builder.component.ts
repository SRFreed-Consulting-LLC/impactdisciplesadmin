import { Component, OnInit } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { FormDefinitionModel } from '@impact-common/shared/models/domain/form-definition.model';
import { FormDefinitionService } from 'src/app/common/services/data/form-definition.service';
import {
  DEFAULT_CONTROL_STYLE,
  FIELD_TYPE_GROUPS,
  FIELD_TYPE_META,
  fieldTypesInGroup,
  FormControlStyle,
  FormFieldDef,
  FormFieldType
} from '@impact-common/shared/models/domain/form-field.model';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { FieldDropEvent, handleFieldDrop } from './field-drop.util';
import { FormTestSubmitDialogComponent } from './form-test-submit-dialog.component';

// Full-page in-place edit view (mode: 'list' | 'edit', no popup - same
// precedent as events.component.ts (events-manager) - the drag-drop canvas
// needs real screen space a MatDialog can't give it.
@Component({
    selector: 'app-form-builder',
    templateUrl: './form-builder.component.html',
    styleUrls: ['./form-builder.component.scss'],
    standalone: false
})
export class FormBuilderComponent implements OnInit {
  mode: 'list' | 'edit' = 'list';

  // ---- List state ----
  forms$: Observable<FormDefinitionModel[]>;
  columns: DataGridColumn<FormDefinitionModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status', filterable: false, value: (item) => (item.status === 'published' ? 'Published' : 'Draft') },
    { key: 'publicUrl', label: 'Public URL', filterable: false, sortable: false },
    { key: 'updatedAt', label: 'Last Updated', type: 'date', dateFormat: 'MMM d, y, h:mm a' }
  ];

  itemType = 'Form';

  private readonly screenKey = 'data.form-builder';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<FormDefinitionModel>[] = [
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }
  ];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // ---- Edit state ----
  editingItem: FormDefinitionModel | null = null;
  isEdit = false;
  nameControl = new FormControl('', { nonNullable: true, validators: Validators.required });
  status: 'draft' | 'published' = 'draft';
  // Whole-form background - see FormDefinitionModel.backgroundColor's own comment.
  backgroundColor = '';
  // See FormDefinitionModel.publicUrl's own comment - purely informational,
  // set by hand once a form is genuinely wired up somewhere.
  publicUrl = '';
  // Default input-chrome styling for every field on this form - see
  // FormControlStyle's own comment. '' / null mean "unset, fall back to
  // DEFAULT_CONTROL_STYLE" - same unset convention backgroundColor uses.
  controlBorderRadius: number | null = null;
  controlBorderColor = '';
  controlAccentColor = '';
  controlPaddingBlock: number | null = null;
  controlPaddingInline: number | null = null;
  readonly defaultControlStyle = DEFAULT_CONTROL_STYLE;
  fields: FormFieldDef[] = [];
  selectedFieldId: string | null = null;
  showPreview = false;
  inProgress$ = new BehaviorSubject<boolean>(false);

  readonly groups = FIELD_TYPE_GROUPS;
  readonly canvasListId = 'canvas-fields';

  // Assembled fresh from the flat controlBorderRadius/controlBorderColor/
  // controlAccentColor properties (same "flat properties, object only at
  // the edges" pattern as everywhere else in this component) - only
  // includes keys that are actually set, so an unset one correctly falls
  // through to DEFAULT_CONTROL_STYLE in the renderer rather than
  // overwriting it with an empty string.
  get controlStyle(): FormControlStyle {
    const style: FormControlStyle = {};
    if (this.controlBorderRadius != null) {
      style.borderRadius = this.controlBorderRadius;
    }
    if (this.controlBorderColor) {
      style.borderColor = this.controlBorderColor;
    }
    if (this.controlAccentColor) {
      style.accentColor = this.controlAccentColor;
    }
    if (this.controlPaddingBlock != null) {
      style.paddingBlock = this.controlPaddingBlock;
    }
    if (this.controlPaddingInline != null) {
      style.paddingInline = this.controlPaddingInline;
    }
    return style;
  }

  constructor(
    private service: FormDefinitionService,
    public permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.forms$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
    this.headerActions = this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : [];
  }

  // ---- Palette helpers ----
  fieldTypesForGroup(group: 'Basic' | 'Advanced' | 'Layout'): FormFieldType[] {
    return fieldTypesInGroup(group);
  }

  meta(type: FormFieldType) {
    return FIELD_TYPE_META[type];
  }

  paletteListId(group: string): string {
    return `palette-${group.toLowerCase()}`;
  }

  // CDK resolves which connected drop list receives a drop by walking the
  // dragged item's *origin* list's own `connectedTo` array and returning
  // the FIRST entry whose bounds contain the pointer - not the smallest/
  // most specific one. A column is nested INSIDE the canvas's own bounding
  // rect (it's a descendant of a canvas child), so the canvas's rect always
  // also "contains" any point over one of its columns; whichever list
  // happens to be checked first in that walk wins. Live-diagnosed: with
  // cdkDropListGroup's automatic (registration-order) connections, canvas
  // registers before its own nested column lists (it's not inside the
  // *ngFor that creates them) and so always won, silently dropping fields
  // meant for a column onto the top-level canvas instead. Listing every
  // column id BEFORE canvasListId here - and binding this same array as
  // every list's own [cdkDropListConnectedTo], not relying on
  // cdkDropListGroup's own ordering - forces the more deeply-nested
  // candidates to be checked first, so a column can actually "win" over its
  // ancestor canvas for a point that's genuinely inside it. Palette lists
  // are never included as a *target* here (only ever a drag origin), which
  // is what keeps a field from being draggable back into the palette.
  allDropListIds(): string[] {
    const columnIds: string[] = [];
    const collect = (fields: FormFieldDef[]): void => {
      fields.forEach((field) => {
        if (field.type === 'columns') {
          (field.columns ?? []).forEach((column, index) => {
            columnIds.push(this.columnListId(field, index));
            collect(column.fields);
          });
        }
      });
    };
    collect(this.fields);
    return [...columnIds, this.canvasListId];
  }

  columnListId(field: FormFieldDef, index: number): string {
    return `column-${field.id}-${index}`;
  }

  onDropped(event: FieldDropEvent): void {
    handleFieldDrop(event);
  }

  selectField(field: FormFieldDef): void {
    this.selectedFieldId = field.id;
  }

  removeField(container: FormFieldDef[], field: FormFieldDef): void {
    const index = container.indexOf(field);
    if (index > -1) {
      container.splice(index, 1);
    }
    if (this.selectedFieldId === field.id) {
      this.selectedFieldId = null;
    }
  }

  get selectedField(): FormFieldDef | null {
    return this.findField(this.fields, this.selectedFieldId);
  }

  private findField(fields: FormFieldDef[], id: string | null): FormFieldDef | null {
    if (!id) {
      return null;
    }
    for (const field of fields) {
      if (field.id === id) {
        return field;
      }
      if (field.type === 'columns') {
        for (const column of field.columns ?? []) {
          const found = this.findField(column.fields, id);
          if (found) {
            return found;
          }
        }
      }
    }
    return null;
  }

  // ---- List actions ----
  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.editingItem = null;
    this.isEdit = false;
    this.nameControl.setValue('');
    this.status = 'draft';
    this.backgroundColor = '';
    this.publicUrl = '';
    this.controlBorderRadius = null;
    this.controlBorderColor = '';
    this.controlAccentColor = '';
    this.controlPaddingBlock = null;
    this.controlPaddingInline = null;
    this.fields = [];
    this.selectedFieldId = null;
    this.showPreview = false;
    this.mode = 'edit';
  }

  showEditModal(item: FormDefinitionModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.editingItem = item;
    this.isEdit = true;
    this.nameControl.setValue(item.name);
    this.status = item.status;
    this.backgroundColor = item.backgroundColor ?? '';
    this.publicUrl = item.publicUrl ?? '';
    this.controlBorderRadius = item.controlStyle?.borderRadius ?? null;
    this.controlBorderColor = item.controlStyle?.borderColor ?? '';
    this.controlAccentColor = item.controlStyle?.accentColor ?? '';
    this.controlPaddingBlock = item.controlStyle?.paddingBlock ?? null;
    this.controlPaddingInline = item.controlStyle?.paddingInline ?? null;
    // Deep clone so Cancel doesn't leave a half-edited object mutated in
    // place on the live list - fields/options/columns are all edited by
    // direct mutation while in the builder (see FormFieldSettingsComponent).
    this.fields = JSON.parse(JSON.stringify(item.fields ?? []));
    this.selectedFieldId = null;
    this.showPreview = false;
    this.mode = 'edit';
  }

  delete(item: FormDefinitionModel): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }

  // ---- Edit actions ----
  openTestSubmit(): void {
    if (!this.editingItem?.id) {
      this.snackbar.error('Save the form before testing it');
      return;
    }
    this.dialog.open(FormTestSubmitDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: {
        formId: this.editingItem.id,
        formName: this.editingItem.name,
        fields: this.fields,
        backgroundColor: this.backgroundColor,
        controlStyle: this.controlStyle
      }
    });
  }

  onSave(): void {
    if (this.nameControl.invalid) {
      this.nameControl.markAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const now = new Date();
    const value: FormDefinitionModel = {
      ...this.editingItem,
      name: this.nameControl.value,
      status: this.status,
      backgroundColor: this.backgroundColor,
      publicUrl: this.publicUrl,
      controlStyle: this.controlStyle,
      fields: this.fields,
      createdAt: this.editingItem?.createdAt ?? now,
      updatedAt: now
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request
      .then(() => {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.inProgress$.next(false);
        this.mode = 'list';
      })
      .catch(() => {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      });
  }

  onCancel(): void {
    this.mode = 'list';
  }
}
