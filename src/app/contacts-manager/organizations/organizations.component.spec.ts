import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { OrganizationsComponent } from './organizations.component';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';

// Characterization, written BEFORE this screen moved onto BaseListComponent
// (2026-09-05). What a base-class adoption could lose here: editing is
// IN-PAGE (a mode switch to OrganizationDetailsComponent), not a dialog;
// the delete confirmation warns that locations and member links are not
// removed with the organization; and the Point of Contact column falls back
// to the deprecated free-text contactName old docs still carry.

function setup(over: { canAdd?: boolean; canEdit?: boolean; canDelete?: boolean; confirm?: boolean } = {}) {
  const stream = new Subject<OrganizationModel[]>();
  const deleted: string[] = [];
  const confirms: string[] = [];
  const messages: string[] = [];

  const service = {
    streamAll: () => stream.asObservable(),
    delete: (id: string) => { deleted.push(id); return Promise.resolve(); }
  } as unknown as OrganizationService;
  const permissionService = {
    canAdd: () => over.canAdd ?? true,
    canEdit: () => over.canEdit ?? true,
    canDelete: () => over.canDelete ?? true
  } as unknown as PermissionService;
  const confirmService = {
    confirm: (msg: string) => { confirms.push(msg); return Promise.resolve(over.confirm ?? true); }
  } as unknown as ConfirmService;
  const snackbar = {
    success: (m: string) => { messages.push(m); },
    error: (m: string) => { messages.push('ERR ' + m); },
    somethingWentWrong: () => { messages.push('ERR'); }
  } as unknown as SnackbarService;

  // The base class takes a MatDialog; this screen edits in page and never
  // opens one, so a dialog that refuses to be used is the honest stub.
  const dialog = { open: () => { throw new Error('Organizations edits in page'); } } as unknown as MatDialog;

  const component = new OrganizationsComponent(service, permissionService, dialog, confirmService, snackbar);
  return { component, stream, deleted, confirms, messages };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('OrganizationsComponent', () => {
  it('starts in list mode with the spinner up until the first emission', () => {
    const { component, stream } = setup();
    component.ngOnInit();
    expect(component.mode).toBe('list');
    expect(component.loading$.value).toBeTrue();

    let rows: OrganizationModel[] = [];
    component.items$.subscribe((r) => (rows = r));
    stream.next([{ id: 'o1', name: 'Grace' } as OrganizationModel]);
    expect(rows.length).toBe(1);
    expect(component.loading$.value).toBeFalse();
  });

  it('offers New only to someone who may add', () => {
    const yes = setup({ canAdd: true });
    yes.component.ngOnInit();
    expect(yes.component.headerActions.map((a) => a.label)).toEqual(['New']);

    const no = setup({ canAdd: false });
    no.component.ngOnInit();
    expect(no.component.headerActions).toEqual([]);
  });

  it('edits IN PAGE: add and edit switch to the details view, close returns to the list', () => {
    const { component } = setup();
    component.showAddModal();
    expect(component.mode).toBe('edit');
    expect(component.editingItem).toBeNull();

    component.onEditClosed();
    expect(component.mode).toBe('list');

    const org = { id: 'o1', name: 'Grace' } as OrganizationModel;
    component.showEditModal(org);
    expect(component.mode).toBe('edit');
    expect(component.editingItem).toBe(org);
  });

  it('refuses add and edit silently without the grant', () => {
    const { component } = setup({ canAdd: false, canEdit: false });
    component.showAddModal();
    component.showEditModal({ id: 'o1' } as OrganizationModel);
    expect(component.mode).toBe('list');
    expect(component.editingItem).toBeNull();
  });

  it('shows the delete action only to someone who may delete', () => {
    expect(setup({ canDelete: true }).component.rowActions[0].visible!({ id: 'o1' } as OrganizationModel)).toBeTrue();
    expect(setup({ canDelete: false }).component.rowActions[0].visible!({ id: 'o1' } as OrganizationModel)).toBeFalse();
  });

  it('deletes after a confirmation that warns about locations and members', async () => {
    const { component, deleted, confirms, messages } = setup();
    component.delete({ id: 'o1', name: 'Grace' } as OrganizationModel);
    await flush();
    expect(confirms.length).toBe(1);
    expect(confirms[0]).toContain('locations and member links are not removed');
    expect(deleted).toEqual(['o1']);
    expect(messages).toEqual(['Organization Deleted']);
  });

  it('does nothing when the confirmation is declined, or without the grant', async () => {
    const declined = setup({ confirm: false });
    declined.component.delete({ id: 'o1' } as OrganizationModel);
    await flush();
    expect(declined.deleted).toEqual([]);

    const ungranted = setup({ canDelete: false });
    ungranted.component.delete({ id: 'o1' } as OrganizationModel);
    await flush();
    expect(ungranted.confirms).toEqual([]);
    expect(ungranted.deleted).toEqual([]);
  });

  it('labels the point of contact from the structured record, else the legacy free text', () => {
    const { component } = setup();
    expect(component.pocLabel({ pointOfContact: { firstName: 'Ann', lastName: 'Lee' } } as OrganizationModel)).toBe('Ann Lee');
    expect(component.pocLabel({ pointOfContact: { firstName: 'Ann' } } as OrganizationModel)).toBe('Ann');
    expect(component.pocLabel({ contactName: 'Old Style' } as OrganizationModel)).toBe('Old Style');
    expect(component.pocLabel({} as OrganizationModel)).toBe('');
  });

  it('reads city, state, phone and email off nested fields for the grid', () => {
    const { component } = setup();
    const byKey = Object.fromEntries(component.columns.map((c) => [c.key, c]));
    const org = { address: { city: 'Athens', state: 'GA' }, phone: { number: '5551234' }, email: 'a@b.c' } as OrganizationModel;
    expect(byKey['city'].value!(org)).toBe('Athens');
    expect(byKey['state'].value!(org)).toBe('GA');
    expect(byKey['phone'].value!(org)).toBe('5551234');
    expect(byKey['email'].value!(org)).toBe('a@b.c');
    expect(byKey['city'].value!({} as OrganizationModel)).toBe('');
    expect(byKey['email'].visible).toBeFalse();
  });
});
