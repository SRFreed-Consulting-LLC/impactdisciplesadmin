import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AdminMessage } from '@impact-common/models/library-user-message.model';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { MessageHistoryComponent } from './message-history.component';

// CHARACTERIZATION tests, written 2026-08-21 BEFORE swapping this screen's
// hand-rolled mat-table for the shared <app-data-grid> (bucket A item #1).
//
// This one DOES use a minimal all-stub TestBed, and that is correct rather
// than a lapse: per the 2026-08-21 decision library-manager KEEPS its modern
// idiom, and this component takes its dependencies through inject() FIELD
// initializers, which require an injection context. TestBed being needed is
// exactly the signal CLAUDE.md describes. Nothing here touches Firebase.

describe('MessageHistoryComponent', () => {
  let component: MessageHistoryComponent;
  let opened: { component: unknown; config: { data: { message: AdminMessage } } }[];

  const aMessage = (extra: Partial<AdminMessage> = {}): AdminMessage =>
    ({
      id: 'm-1',
      title: 'Server maintenance',
      sentByName: 'Ada Admin',
      recipientScope: 'selected',
      recipientCount: 4,
      pushSuccessCount: 3,
      ...extra,
    }) as AdminMessage;

  function configure(messages: AdminMessage[]): void {
    opened = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MessageHistoryComponent,
        { provide: LibraryUserService, useValue: { getAdminMessages: () => of(messages) } },
        {
          provide: MatDialog,
          useValue: {
            open: (c: unknown, config: { data: { message: AdminMessage } }) => {
              opened.push({ component: c, config });
            },
          },
        },
      ],
    });
    component = TestBed.inject(MessageHistoryComponent);
  }

  describe('loading', () => {
    it('fills the list from the stream and clears the spinner', () => {
      configure([aMessage(), aMessage({ id: 'm-2' })]);
      expect(component.messages().length).toBe(2);
      expect(component.loading()).toBeFalse();
    });

    it('clears the spinner even when there is nothing to show', () => {
      configure([]);
      expect(component.messages()).toEqual([]);
      expect(component.loading()).toBeFalse();
    });
  });

  describe('scopeLabel', () => {
    it('spells out an all-users broadcast with its count', () => {
      configure([]);
      expect(component.scopeLabel(aMessage({ recipientScope: 'all', recipientCount: 120 })))
        .toBe('All library users (120)');
    });

    it('says "selected" for a targeted send', () => {
      configure([]);
      expect(component.scopeLabel(aMessage({ recipientScope: 'selected', recipientCount: 4 })))
        .toBe('4 selected');
    });
  });

  describe('deliveredLabel', () => {
    it('reads as delivered-over-recipients, not a pass/fail', () => {
      // Push delivery is best-effort; everyone gets the inbox copy anyway,
      // so a shortfall here is information, not an error.
      configure([]);
      expect(component.deliveredLabel(aMessage({ pushSuccessCount: 3, recipientCount: 4 }))).toBe('3/4');
      expect(component.deliveredLabel(aMessage({ pushSuccessCount: 0, recipientCount: 4 }))).toBe('0/4');
    });
  });

  describe('openDetail', () => {
    it('opens the detail dialog with the message', () => {
      configure([]);
      const message = aMessage({ id: 'm-7' });
      component.openDetail(message);
      expect(opened.length).toBe(1);
      expect(opened[0].config.data.message).toBe(message);
    });
  });
});
