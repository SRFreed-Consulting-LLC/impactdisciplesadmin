import { FormBuilder } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { SnackbarService, SOMETHING_WENT_WRONG } from '../../shared/snackbar.service';
import { OrganizationLocationDialogComponent } from './organization-location-dialog.component';

// Characterization, written BEFORE this dialog moved onto
// BaseEntityDialogComponent (2026-09-05), so the move could be checked
// against what the dialog actually did rather than what it looked like it
// did. The two facts a plain base-class adoption could lose are pinned
// hardest: the parent organization is stamped from the dialog DATA (it is
// not a form field), and trainingrooms are carried across untouched
// (rooms belong to the Summit venue and are edited elsewhere).

function setup(over: {
  item?: LocationModel | null;
  result?: LocationModel | undefined;
  reject?: boolean;
} = {}) {
  const calls = { add: [] as LocationModel[], update: [] as [string, LocationModel][] };
  const closed: (boolean | undefined)[] = [];
  const messages = { success: [] as string[], error: [] as string[] };

  const answer = () => over.reject
    ? Promise.reject(new Error('permission-denied'))
    : Promise.resolve('result' in over ? over.result : ({ id: 'saved-1' } as LocationModel));

  const service = {
    add: (v: LocationModel) => { calls.add.push(v); return answer(); },
    update: (id: string, v: LocationModel) => { calls.update.push([id, v]); return answer(); }
  } as unknown as LocationService;
  const dialogRef = {
    close: (r?: boolean) => { closed.push(r); }
  } as unknown as MatDialogRef<OrganizationLocationDialogComponent, boolean>;
  const snackbar = {
    success: (m: string) => { messages.success.push(m); },
    error: (m: string) => { messages.error.push(m); },
    somethingWentWrong: () => { messages.error.push(SOMETHING_WENT_WRONG); }
  } as unknown as SnackbarService;

  const dialog = new OrganizationLocationDialogComponent(
    dialogRef,
    { item: over.item ?? null, organizationId: 'org-9' },
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

describe('OrganizationLocationDialogComponent', () => {
  it('is an add with no item, an edit once the item has an id', () => {
    expect(setup({ item: null }).dialog.isEdit).toBeFalse();
    expect(setup({ item: { name: 'Draft' } as LocationModel }).dialog.isEdit).toBeFalse();
    expect(setup({ item: { id: 'l1', name: 'Hall' } as LocationModel }).dialog.isEdit).toBeTrue();
  });

  it('seeds the form from the item, nested address and phone included', () => {
    const { dialog } = setup({
      item: {
        id: 'l1', name: 'Hall', contactName: 'Pat',
        address: { address1: '1 Main', city: 'Athens', state: 'GA', zip: '30601' },
        phone: { number: '5551234' }
      } as LocationModel
    });
    expect(dialog.form.value.name).toBe('Hall');
    expect(dialog.form.value.contactName).toBe('Pat');
    expect(dialog.form.value.address.city).toBe('Athens');
    expect(dialog.form.value.phone.number).toBe('5551234');
  });

  it('refuses to save without a name, and never starts the spinner', () => {
    const { dialog, calls } = setup();
    dialog.form.patchValue({ name: '' });
    dialog.onSave();
    expect(calls.add.length).toBe(0);
    expect(dialog.form.touched).toBeTrue();
    expect(dialog.inProgress$.value).toBeFalse();
  });

  it('stamps the parent organization from the dialog data, not the form', async () => {
    const { dialog, calls } = setup({ item: null });
    dialog.form.patchValue({ name: 'Annex' });
    dialog.onSave();
    await flush();
    expect(calls.add.length).toBe(1);
    expect(calls.add[0].organization).toBe('org-9');
    expect(calls.add[0].name).toBe('Annex');
  });

  it('carries an existing location\'s rooms across untouched on edit', async () => {
    const rooms = [{ id: 'r1', name: 'Room A' }] as LocationModel['trainingrooms'];
    const { dialog, calls } = setup({ item: { id: 'l1', name: 'Hall', trainingrooms: rooms } as LocationModel });
    dialog.form.patchValue({ name: 'Hall East' });
    dialog.onSave();
    await flush();
    expect(calls.update.length).toBe(1);
    expect(calls.update[0][0]).toBe('l1');
    expect(calls.update[0][1].trainingrooms).toEqual(rooms);
    expect(calls.update[0][1].name).toBe('Hall East');
  });

  it('gives a brand-new location an empty rooms list', async () => {
    const { dialog, calls } = setup({ item: null });
    dialog.form.patchValue({ name: 'Annex' });
    dialog.onSave();
    await flush();
    expect(calls.add[0].trainingrooms).toEqual([]);
  });

  it('reports Added or Updated and closes true', async () => {
    const add = setup({ item: null });
    add.dialog.form.patchValue({ name: 'Annex' });
    add.dialog.onSave();
    await flush();
    expect(add.messages.success).toEqual(['Location Added']);
    expect(add.closed).toEqual([true]);

    const edit = setup({ item: { id: 'l1', name: 'Hall' } as LocationModel });
    edit.dialog.onSave();
    await flush();
    expect(edit.messages.success).toEqual(['Location Updated']);
    expect(edit.closed).toEqual([true]);
  });

  it('recovers from a rejected write: spinner off, message shown, dialog still open', async () => {
    const { dialog, closed, messages } = setup({ item: { id: 'l1', name: 'Hall' } as LocationModel, reject: true });
    dialog.onSave();
    await flush();
    expect(dialog.inProgress$.value).toBeFalse();
    expect(messages.error).toEqual([SOMETHING_WENT_WRONG]);
    expect(closed).toEqual([]);
  });

  it('treats a falsy result as a write that did not happen', async () => {
    const { dialog, closed, messages } = setup({ item: null, result: undefined });
    dialog.form.patchValue({ name: 'Annex' });
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
