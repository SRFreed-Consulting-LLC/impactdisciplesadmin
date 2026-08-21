import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { LibraryPermissionService } from 'src/app/common/services/data/library/library-permission.service';
import { LibraryErrorLogService } from 'src/app/common/services/data/library/library-error-log.service';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryUserDetailComponent } from './library-user-detail.component';

// CHARACTERIZATION tests, written 2026-08-21 BEFORE swapping this screen's
// licenses mat-table for the shared <app-data-grid> (bucket A item #1).
//
// The licenses panel is the part being converted, so that is what is
// pinned - and specifically its SAFETY properties, which are easy to lose
// when action buttons move into the grid's rowActions:
//  - both removals refuse a non-Admin outright, and
//  - each refuses a license of the wrong source, so the admin-grant path
//    can never revoke a store purchase (which would silently take away
//    something a customer paid for, without refunding it).
//
// Minimal all-stub TestBed - the component takes its dependencies through
// inject() field initializers, correct now the module keeps its modern
// idiom (see CLAUDE.md).

describe('LibraryUserDetailComponent licenses', () => {
  let component: LibraryUserDetailComponent;
  let revokedGranted: unknown[][];
  let revokedStore: unknown[][];
  let snackbar: { success: jasmine.Spy; error: jasmine.Spy };
  let logged: unknown[];
  let confirmResult: boolean;
  let confirmText: string;
  let isFullAccess: boolean;

  const aLicense = (bookId: string, source: string) => ({ bookId, source }) as never;

  function configure(user: Partial<LibraryUser> | null, books: { id: string; title: string }[] = []): void {
    revokedGranted = [];
    revokedStore = [];
    logged = [];
    confirmResult = true;
    confirmText = '';
    isFullAccess = true;
    snackbar = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        LibraryUserDetailComponent,
        FormBuilder,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'ada%40test.local' } } },
        },
        {
          provide: LibraryUserService,
          useValue: {
            getLibraryUser: () => of(user),
            revokeGrantedLicense: (...args: unknown[]) => { revokedGranted.push(args); return Promise.resolve(); },
            revokeStoreLicense: (...args: unknown[]) => { revokedStore.push(args); return Promise.resolve(); },
          },
        },
        { provide: LibraryBookService, useValue: { getAll: () => Promise.resolve(books) } },
        { provide: LibraryPermissionService, useValue: { isFullAccess: () => isFullAccess } },
        {
          provide: ConfirmService,
          useValue: { confirm: (text: string) => { confirmText = text; return Promise.resolve(confirmResult); } },
        },
        { provide: SnackbarService, useValue: snackbar },
        { provide: LibraryErrorLogService, useValue: { logError: (...a: unknown[]) => logged.push(a) } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(undefined) }) } },
      ],
    });
    component = TestBed.inject(LibraryUserDetailComponent);
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

  describe('the list', () => {
    it('sorts licenses by BOOK TITLE, not by id', async () => {
      configure(
        { bookLicenses: [aLicense('b-2', 'admin-grant'), aLicense('b-1', 'admin-grant')] } as Partial<LibraryUser>,
        [{ id: 'b-1', title: 'Zebra' }, { id: 'b-2', title: 'Apple' }],
      );
      await flush();
      expect(component.licenses().map((l) => l.bookId)).toEqual(['b-2', 'b-1']);
    });

    it('is empty when the user has no licenses', () => {
      configure({} as Partial<LibraryUser>);
      expect(component.licenses()).toEqual([]);
    });

    it('falls back to the book id when the title is unknown', () => {
      configure({} as Partial<LibraryUser>);
      expect(component.bookTitle('b-unknown')).toBe('b-unknown');
    });

    it('flags an international user as having every book', () => {
      // Which makes the per-book list moot.
      configure({ internationalUser: true } as Partial<LibraryUser>);
      expect(component.hasAllBooks()).toBeTrue();
    });
  });

  describe('removing an admin-granted license', () => {
    it('confirms, revokes with email/bookId/name/title, and reports', async () => {
      configure({ bookLicenses: [aLicense('b-1', 'admin-grant')] } as Partial<LibraryUser>,
        [{ id: 'b-1', title: 'Book One' }]);
      await flush();
      await component.removeLicense(component.licenses()[0]);
      await flush();

      expect(revokedGranted.length).toBe(1);
      expect(revokedGranted[0][1]).toBe('b-1');
      expect(revokedGranted[0][3]).toBe('Book One');
      expect(snackbar.success).toHaveBeenCalledWith('License for "Book One" removed.');
    });

    it('refuses a NON-ADMIN outright', async () => {
      configure({ bookLicenses: [aLicense('b-1', 'admin-grant')] } as Partial<LibraryUser>);
      await flush();
      isFullAccess = false;
      await component.removeLicense(component.licenses()[0]);
      expect(revokedGranted).toEqual([]);
    });

    it('refuses a license of the WRONG source', async () => {
      // Otherwise this path could revoke something a customer paid for.
      configure({ bookLicenses: [aLicense('b-1', 'store-purchase')] } as Partial<LibraryUser>);
      await flush();
      await component.removeLicense(component.licenses()[0]);
      expect(revokedGranted).toEqual([]);
    });

    it('does nothing when declined', async () => {
      configure({ bookLicenses: [aLicense('b-1', 'admin-grant')] } as Partial<LibraryUser>);
      await flush();
      confirmResult = false;
      await component.removeLicense(component.licenses()[0]);
      expect(revokedGranted).toEqual([]);
    });
  });

  describe('removing a store-purchased license', () => {
    it('warns in the confirm that this is NOT a refund', async () => {
      configure({ bookLicenses: [aLicense('b-1', 'store-purchase')] } as Partial<LibraryUser>,
        [{ id: 'b-1', title: 'Book One' }]);
      await flush();
      await component.removeStoreLicense(component.licenses()[0]);
      expect(confirmText).toContain('does NOT refund');
      expect(revokedStore.length).toBe(1);
    });

    it('refuses a license of the wrong source', async () => {
      configure({ bookLicenses: [aLicense('b-1', 'admin-grant')] } as Partial<LibraryUser>);
      await flush();
      await component.removeStoreLicense(component.licenses()[0]);
      expect(revokedStore).toEqual([]);
    });

    it('logs and shows a fixed sentence on failure', async () => {
      configure({ bookLicenses: [aLicense('b-1', 'store-purchase')] } as Partial<LibraryUser>);
      await flush();
      TestBed.inject(LibraryUserService).revokeStoreLicense =
        () => Promise.reject(new Error('raw')) as never;
      await component.removeStoreLicense(component.licenses()[0]);
      await flush();

      expect(snackbar.error).toHaveBeenCalledWith('Could not remove that license. Please try again.');
      expect(logged.length).toBe(1);
    });
  });
});
