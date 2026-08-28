import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { BaseModel } from '@impact-common/shared/models/base.model';
import {
  BaseEntityDialogComponent,
  EntityDialogService
} from './base-entity-dialog.component';
import { SnackbarService } from './snackbar.service';

// Sweep finding C4. This save routine existed in TEN copies and was tested
// in NONE of them, which is exactly how a fix applied to one copy on
// 2026-08-15 was still missing from eighteen others two weeks later.
//
// It lives in one place now, so it can finally be pinned. The rejection
// case below is the one that matters most: without it the spinner span
// forever and the dialog could never be closed or dismissed.

interface Thing extends BaseModel {
  name?: string;
}

class TestDialog extends BaseEntityDialogComponent<Thing> {
  readonly itemType = 'Thing';

  constructor(
    protected readonly service: EntityDialogService<Thing>,
    protected readonly dialogRef: MatDialogRef<unknown, boolean>,
    protected readonly snackbar: SnackbarService,
    protected readonly data: { item: Thing | null },
    form: FormGroup
  ) {
    super();
    this.form = form;
  }
}

/** A dialog that contributes a field the form does not hold. */
class ExtraFieldDialog extends TestDialog {
  protected override buildValue(): Thing {
    return { ...super.buildValue(), name: 'from-the-dialog' };
  }
}

function setup(over: {
  item?: Thing | null;
  result?: Thing | undefined;
  reject?: boolean;
  required?: boolean;
  ctor?: typeof TestDialog;
} = {}) {
  const calls = { add: [] as Thing[], update: [] as [string, Thing][] };
  const closed: (boolean | undefined)[] = [];
  const messages = { success: [] as string[], error: [] as string[] };

  const answer = () => over.reject
    ? Promise.reject(new Error('permission-denied'))
    : Promise.resolve(over.result === undefined && !('result' in over)
      ? ({ id: 'saved-1' } as Thing)
      : over.result);

  const service: EntityDialogService<Thing> = {
    add: (v) => { calls.add.push(v); return answer(); },
    update: (id, v) => { calls.update.push([id, v]); return answer(); }
  };
  // Duck-typed: the skeleton uses close()/success()/error() and nothing
  // else, so standing up the real classes would only add framework to the
  // failure path.
  const dialogRef = {
    close: (r?: boolean) => { closed.push(r); }
  } as unknown as MatDialogRef<unknown, boolean>;
  const snackbar = {
    success: (m: string) => { messages.success.push(m); },
    error: (m: string) => { messages.error.push(m); }
  } as unknown as SnackbarService;

  const fb = new FormBuilder();
  const form = fb.group({
    name: ['Widget', over.required ? Validators.required : []]
  });

  const Ctor = over.ctor ?? TestDialog;
  const dialog = new Ctor(
    service, dialogRef, snackbar,
    { item: over.item ?? null },
    form
  );
  return { dialog, calls, closed, messages, form };
}

describe('BaseEntityDialogComponent', () => {
  describe('isEdit', () => {
    it('is an add when there is no item', () => {
      expect(setup({ item: null }).dialog.isEdit).toBeFalse();
    });

    it('is an add when the item has no id yet', () => {
      // A dialog can be handed a pre-filled but unsaved item - all ten
      // copies keyed on the id for exactly this reason.
      expect(setup({ item: { name: 'Draft' } }).dialog.isEdit).toBeFalse();
    });

    it('is an edit once the item has an id', () => {
      expect(setup({ item: { id: 'x1' } }).dialog.isEdit).toBeTrue();
    });
  });

  describe('onCancel', () => {
    it('closes with false so the caller does not reload', () => {
      const { dialog, closed } = setup();
      dialog.onCancel();
      expect(closed).toEqual([false]);
    });
  });

  describe('onSave', () => {
    it('refuses an invalid form and touches it so errors show', () => {
      const { dialog, form, calls } = setup({ required: true });
      form.patchValue({ name: '' });

      dialog.onSave();

      expect(calls.add.length).toBe(0);
      expect(form.touched).toBeTrue();
      // The spinner must never start for a write that never happens.
      expect(dialog.inProgress$.value).toBeFalse();
    });

    it('adds when there is no id, and reports it as added', async () => {
      const { dialog, calls, closed, messages } = setup({ item: null });

      dialog.onSave();
      await Promise.resolve();
      await Promise.resolve();

      expect(calls.add.length).toBe(1);
      expect(calls.update.length).toBe(0);
      expect(messages.success).toEqual(['Thing Added']);
      expect(closed).toEqual([true]);
    });

    it('updates when there is an id, and reports it as updated', async () => {
      const { dialog, calls, messages } = setup({ item: { id: 'x1' } });

      dialog.onSave();
      await Promise.resolve();
      await Promise.resolve();

      expect(calls.update.length).toBe(1);
      expect(calls.update[0][0]).toBe('x1');
      expect(messages.success).toEqual(['Thing Updated']);
    });

    it('merges the form over the existing item', async () => {
      const { dialog, calls } = setup({ item: { id: 'x1', name: 'Old' } });

      dialog.onSave();
      await Promise.resolve();

      expect(calls.update[0][1].id).toBe('x1');
      expect(calls.update[0][1].name).toBe('Widget');
    });

    it('lets a subclass contribute a field the form does not hold', async () => {
      const { dialog, calls } = setup({ item: null, ctor: ExtraFieldDialog });

      dialog.onSave();
      await Promise.resolve();

      expect(calls.add[0].name).toBe('from-the-dialog');
    });

    // THE REGRESSION THIS CLASS EXISTS TO PREVENT. Live-diagnosed
    // 2026-08-15, fixed in one dialog, still present in eighteen others on
    // 2026-08-27.
    it('recovers from a REJECTED write instead of spinning forever', async () => {
      const { dialog, closed, messages } = setup({ reject: true });

      dialog.onSave();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(dialog.inProgress$.value).withContext('spinner stuck').toBeFalse();
      expect(messages.error).toEqual(['Some Error Occured']);
      // Deliberately still open: the user's work is not thrown away.
      expect(closed).toEqual([]);
    });

    it('treats a falsy result as a write that did not happen', async () => {
      const { dialog, closed, messages } = setup({ result: undefined });

      dialog.onSave();
      await Promise.resolve();
      await Promise.resolve();

      expect(dialog.inProgress$.value).toBeFalse();
      expect(messages.error).toEqual(['Some Error Occured']);
      expect(messages.success).toEqual([]);
      expect(closed).toEqual([]);
    });

    it('raises the spinner while the write is in flight', () => {
      const { dialog } = setup();
      dialog.onSave();
      expect(dialog.inProgress$.value).toBeTrue();
    });
  });
});
