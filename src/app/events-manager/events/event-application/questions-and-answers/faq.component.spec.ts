import { MatDialog } from '@angular/material/dialog';
import { SimpleChange } from '@angular/core';
import { Subject } from 'rxjs';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { FAQModel } from '@impact-common/shared/models/utils/faq.model';
import { FAQService } from 'src/app/common/services/data/faq.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../../shared/snackbar.service';
import { FAQComponent } from './faq.component';
import { FaqDialogComponent } from './faq-dialog.component';

// Characterization, written BEFORE this screen moved onto BaseListComponent
// (2026-09-05). Two concerns share one table here: a global FAQ library
// (add/edit/delete) and an event's MEMBERSHIP in it via checkbox selection.
// What an adoption could lose: the selection is seeded from event.faqList
// exactly once and never clobbered by later emissions; a delete also drops
// the row from the event; and this screen is UNGATED (no screenKey - it
// lives inside the event editor, which is what gates it).

function setup(over: { confirm?: boolean; faqList?: FAQModel[] } = {}) {
  const stream = new Subject<FAQModel[]>();
  const deleted: string[] = [];
  const opened: { component: unknown; config: { width?: string; data?: { item: FAQModel | null } } }[] = [];
  const messages: string[] = [];

  const service = {
    streamAll: () => stream.asObservable(),
    delete: (id: string) => { deleted.push(id); return Promise.resolve(); }
  } as unknown as FAQService;
  const dialog = {
    open: (component: unknown, config: { width?: string; data?: { item: FAQModel | null } }) => { opened.push({ component, config }); }
  } as unknown as MatDialog;
  const confirmService = {
    confirm: () => Promise.resolve(over.confirm ?? true)
  } as unknown as ConfirmService;
  const snackbar = {
    success: (m: string) => { messages.push(m); },
    somethingWentWrong: () => { messages.push('ERR'); }
  } as unknown as SnackbarService;

  // Ungated screen: the permission service must never be consulted.
  const permissionService = {
    canAdd: () => { throw new Error('FAQ is ungated'); },
    canEdit: () => { throw new Error('FAQ is ungated'); },
    canDelete: () => { throw new Error('FAQ is ungated'); }
  } as unknown as PermissionService;

  const component = new FAQComponent(service, permissionService, dialog, confirmService, snackbar);
  component.event = { id: 'e1', faqList: over.faqList } as EventModel;
  return { component, stream, deleted, opened, messages };
}

const q = (id: string, question = id): FAQModel => ({ id, question, answer: '<p>' + id + '</p>', sortOrder: 1 } as FAQModel);

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('FAQComponent', () => {
  it('is ungated: New is always offered, delete always visible', () => {
    const { component } = setup();
    component.ngOnInit();
    expect(component.headerActions.map((a) => a.label)).toEqual(['New']);
    const visible = component.rowActions[0].visible;
    expect(!visible || visible(q('a'))).toBeTrue();
  });

  it('seeds the selection from the event\'s faqList on the first emission only', () => {
    const { component, stream } = setup({ faqList: [q('a')] });
    component.ngOnInit();
    component.items$.subscribe();
    stream.next([q('a'), q('b')]);
    expect(component.selection.selected.map((f) => f.id)).toEqual(['a']);
    expect(component.loading$.value).toBeFalse();

    // A user deselects, then the library re-emits: their choice stands.
    component.selection.clear();
    stream.next([q('a'), q('b')]);
    expect(component.selection.selected).toEqual([]);
  });

  it('initialises an event with no faqList to an empty one', () => {
    const { component, stream } = setup({ faqList: undefined });
    component.ngOnInit();
    component.items$.subscribe();
    stream.next([q('a')]);
    expect(component.event.faqList).toEqual([]);
  });

  it('re-seeds when a different event arrives', () => {
    const { component, stream } = setup({ faqList: [q('a')] });
    component.ngOnInit();
    component.items$.subscribe();
    stream.next([q('a'), q('b')]);
    component.selection.clear();

    component.event = { id: 'e2', faqList: [q('b')] } as EventModel;
    component.ngOnChanges({ event: new SimpleChange({ id: 'e1' }, component.event, false) });
    stream.next([q('a'), q('b')]);
    expect(component.selection.selected.map((f) => f.id)).toEqual(['b']);
  });

  it('writes the selection back onto the event', () => {
    const { component } = setup({ faqList: [] });
    component.selection.select(q('a'));
    component.onSelectionChange();
    expect(component.event.faqList!.map((f) => f.id)).toEqual(['a']);
  });

  it('opens the dialog at 700px for add and edit', () => {
    const { component, opened } = setup();
    component.showAddModal();
    component.showEditModal(q('a'));
    expect(opened.map((o) => o.component)).toEqual([FaqDialogComponent, FaqDialogComponent]);
    expect(opened[0].config.width).toBe('700px');
    expect(opened[0].config.data).toEqual({ item: null });
    expect(opened[1].config.data!.item!.id).toBe('a');
  });

  it('deleting a FAQ also drops it from the event', async () => {
    const { component, deleted, messages } = setup({ faqList: [q('a')] });
    component.selection.select(q('a'));
    component.event.faqList = component.selection.selected;

    component.delete(component.selection.selected[0]);
    await flush();
    expect(deleted).toEqual(['a']);
    expect(component.selection.selected).toEqual([]);
    expect(component.event.faqList).toEqual([]);
    expect(messages).toEqual(['FAQ Deleted']);
  });

  it('does nothing when the delete is declined', async () => {
    const { component, deleted } = setup({ confirm: false });
    component.delete(q('a'));
    await flush();
    expect(deleted).toEqual([]);
  });

  it('exports the answer as plain text', () => {
    const { component } = setup();
    const answer = component.columns.find((c) => c.key === 'answer')!;
    expect(answer.exportValue!({ answer: '<p>Hi <b>there</b></p>' } as FAQModel)).toBe('Hi there');
    expect(answer.exportValue!({} as FAQModel)).toBe('');
  });
});
