import { FormBuilder } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from 'firebase/firestore';
import { TestimonialModel } from '@impact-common/shared/models/domain/testimonial.model';
import { TESTIMONIAL_TYPES } from '@impact-common/shared/lists/testimonial_types.enum';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { SnackbarService, SOMETHING_WENT_WRONG } from '../snackbar.service';
import { TestimonialDialogComponent } from './testimonial-dialog.component';

// Characterization, written BEFORE this dialog moved onto
// BaseEntityDialogComponent (2026-09-05). The facts a plain adoption could
// lose: `date` is re-stamped to now on EVERY save, add and edit alike (the
// original store's behaviour, kept on purpose), and `quote` - a field the
// public page renders - is seeded and saved even though it was missing from
// the form for a while.

function setup(over: {
  item?: TestimonialModel | null;
  result?: TestimonialModel | undefined;
  reject?: boolean;
} = {}) {
  const calls = { add: [] as TestimonialModel[], update: [] as [string, TestimonialModel][] };
  const closed: (boolean | undefined)[] = [];
  const messages = { success: [] as string[], error: [] as string[] };

  const answer = () => over.reject
    ? Promise.reject(new Error('permission-denied'))
    : Promise.resolve('result' in over ? over.result : ({ id: 'saved-1' } as TestimonialModel));

  const service = {
    add: (v: TestimonialModel) => { calls.add.push(v); return answer(); },
    update: (id: string, v: TestimonialModel) => { calls.update.push([id, v]); return answer(); }
  } as unknown as TestimonialService;
  const dialogRef = {
    close: (r?: boolean) => { closed.push(r); }
  } as unknown as MatDialogRef<TestimonialDialogComponent, boolean>;
  const snackbar = {
    success: (m: string) => { messages.success.push(m); },
    error: (m: string) => { messages.error.push(m); },
    somethingWentWrong: () => { messages.error.push(SOMETHING_WENT_WRONG); }
  } as unknown as SnackbarService;

  const dialog = new TestimonialDialogComponent(
    dialogRef,
    { item: over.item ?? null },
    new FormBuilder(),
    service,
    snackbar
  );
  return { dialog, calls, closed, messages };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const valid = (): Partial<TestimonialModel> => ({
  author: 'Sam', text: 'Changed my life.', type: TESTIMONIAL_TYPES.HOME
});

describe('TestimonialDialogComponent', () => {
  it('is an add with no item, an edit once the item has an id', () => {
    expect(setup({ item: null }).dialog.isEdit).toBeFalse();
    expect(setup({ item: { id: 't1' } as TestimonialModel }).dialog.isEdit).toBeTrue();
  });

  it('seeds every field including quote, which the public page renders', () => {
    const { dialog } = setup({
      item: { id: 't1', isActive: true, author: 'Sam', title: 'Coach', quote: 'Best year', text: 'Body', type: TESTIMONIAL_TYPES.COACHING } as TestimonialModel
    });
    expect(dialog.form.value).toEqual({
      isActive: true, author: 'Sam', title: 'Coach', quote: 'Best year', text: 'Body', type: TESTIMONIAL_TYPES.COACHING
    });
  });

  it('requires author, text and type', () => {
    const { dialog, calls } = setup();
    dialog.onSave();
    expect(calls.add.length).toBe(0);
    expect(dialog.form.touched).toBeTrue();
    expect(dialog.inProgress$.value).toBeFalse();
  });

  it('re-stamps date to now on add AND on edit', async () => {
    const before = Timestamp.now().toMillis();

    const add = setup({ item: null });
    add.dialog.form.patchValue(valid());
    add.dialog.onSave();
    await flush();
    const added = calls(add).add[0].date as Timestamp;
    expect(added.toMillis()).toBeGreaterThanOrEqual(before);

    const old = Timestamp.fromMillis(1_600_000_000_000);
    const edit = setup({ item: { id: 't1', ...valid(), date: old } as TestimonialModel });
    edit.dialog.onSave();
    await flush();
    const updated = calls(edit).update[0][1].date as Timestamp;
    expect(updated.toMillis()).toBeGreaterThanOrEqual(before);
    expect(calls(edit).update[0][0]).toBe('t1');
  });

  it('previews as the coaching page only when the type is Coaching, splitting on blank lines', () => {
    const { dialog } = setup();
    dialog.form.patchValue({ ...valid(), text: 'One.\n\nTwo.\n\n\n  Three.  ' });
    expect(dialog.isCoaching).toBeFalse();
    dialog.form.patchValue({ type: TESTIMONIAL_TYPES.COACHING });
    expect(dialog.isCoaching).toBeTrue();
    expect(dialog.previewParagraphs).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('reports Added or Updated and closes true', async () => {
    const add = setup({ item: null });
    add.dialog.form.patchValue(valid());
    add.dialog.onSave();
    await flush();
    expect(add.messages.success).toEqual(['Testimonial Added']);
    expect(add.closed).toEqual([true]);

    const edit = setup({ item: { id: 't1', ...valid() } as TestimonialModel });
    edit.dialog.onSave();
    await flush();
    expect(edit.messages.success).toEqual(['Testimonial Updated']);
  });

  it('recovers from a rejected write: spinner off, message shown, dialog still open', async () => {
    const { dialog, closed, messages } = setup({ item: { id: 't1', ...valid() } as TestimonialModel, reject: true });
    dialog.onSave();
    await flush();
    expect(dialog.inProgress$.value).toBeFalse();
    expect(messages.error).toEqual([SOMETHING_WENT_WRONG]);
    expect(closed).toEqual([]);
  });

  it('cancel closes false', () => {
    const { dialog, closed } = setup();
    dialog.onCancel();
    expect(closed).toEqual([false]);
  });
});

function calls(s: ReturnType<typeof setup>) {
  return s.calls;
}
