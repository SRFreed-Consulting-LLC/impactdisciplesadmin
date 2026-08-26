import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { SharedModule } from 'src/app/shared/shared.module';
import { DataGridColumn } from 'src/app/shared/data-grid/data-grid.model';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { LibraryDiscussionGroupService } from 'src/app/common/services/data/library/library-discussion-group.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { DiscussionGroup, GroupMembership } from '@impact-common/models/discussion-group.model';

/** How a patron relates to Impact Groups, collapsed to one filterable
 *  value. 'Pending' is its own role rather than being folded into blank:
 *  someone who has only ever asked to join is a real, actionable state (an
 *  unanswered request) and should be findable by filtering this column, not
 *  indistinguishable from a patron in no group at all. */
export type GroupRole = 'Leader' | 'Member' | 'Leader & Member' | 'Pending' | '';

/** Whether this patron can read any book at all, and why. 'International'
 *  outranks 'Licensed' deliberately: an international patron reads every
 *  book free regardless of what `licensedBookIds` happens to hold (see
 *  LibraryUser.internationalUser and firestore.rules' isInternationalPatron),
 *  so reporting them as merely "Licensed" would understate their access. */
export type BookAccess = 'International' | 'Licensed' | 'None';

/** Flat, report-specific row - deliberately not LibraryUser itself, same
 *  convention as the Purchase report's ReportRow. Everything the grid sorts,
 *  filters or exports is precomputed here, so no column has to walk the
 *  group/book joins per render. */
export interface DigitalBookUserRow {
  name: string;
  email: string;
  /** From LibraryUser.createdAt (epoch ms) as a real Date - the grid's
   *  'date' columns run values through dateFromTimestamp(), which does NOT
   *  recognize a bare epoch number and would render the cell blank. Null for
   *  the (rare) doc with no createdAt at all. */
  signedUp: Date | null;
  lastLogin: Date | null;
  /** Count of explicit `licensedBookIds` entries - NOT "books readable",
   *  which for an international patron is the whole catalog. See `access`. */
  licensedBookCount: number;
  bookTitles: string;
  access: BookAccess;
  /** How the licences were obtained, counted by source.
   *
   *  Mostly "Legacy" today and that is expected: 157 of prod's 163 licence
   *  entries predate provenance being recorded, and they carry nothing to
   *  infer it from - no purchase id, no group id, no granter. Every grant
   *  written from now on stamps its source, so this fills in over time. It
   *  says Legacy rather than guessing, because a report that guesses is
   *  worse than one that admits a gap. */
  licensedVia: string;
  /** Coupon codes used on the purchases that granted these licences.
   *
   *  Resolved through the licence entry's own storePurchaseId, so it is the
   *  coupon on the purchase that ACTUALLY granted the book - not merely one
   *  the patron used at some point. Blank where no licence names a purchase,
   *  which today is every legacy entry. */
  coupon: string;
  groupRole: GroupRole;
  groups: string;
  status: 'Active' | 'REVOKED';
}

const lower = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/**
 * Reports Manager > Digital Book Users - every reader-app patron in signup
 * order (newest first), the books they have access to, and their standing in
 * Impact Groups (started one, belongs to one, or waiting on a request).
 *
 * Four one-shot reads joined client-side: `libraryUsers`, every
 * `discussionGroups` doc, every membership doc via one unfiltered
 * collectionGroup('members') query (admin-only under firestore.rules - see
 * LibraryDiscussionGroupService.getAllMemberships), and the flat book list
 * for id -> title. All four are needed whole: a report ordered by signup date
 * across everyone, joined to groups, can't be served page-by-page the way the
 * Library Users roster is, so this deliberately does the same
 * whole-collection read of `libraryUsers` the World Map already does.
 *
 * The grid owns filtering, sorting, the Columns menu and the Excel export -
 * the only screen-level control is the "Has book access" toggle, which is a
 * genuine row-level population filter rather than a column one.
 *
 * KNOWN CAVEAT: `createdAt` on a patron imported by the reader repo's
 * backfill-users.js is the IMPORT date, not their original signup - the
 * oldest stretch of this report bunches every legacy patron onto whichever
 * day that import ran. Nothing here can recover the true date; Last Login is
 * shown alongside as the honest second signal.
 */
@Component({
  selector: 'app-digital-book-user-report',
  standalone: true,
  // SharedModule for <app-data-grid>; MatSlideToggleModule for the header
  // toggle projected into the grid's [dataGridHeaderExtra] slot (SharedModule
  // exports this app's own components, not Material modules).
  imports: [CommonModule, SharedModule, MatSlideToggleModule],
  templateUrl: './digital-book-user-report.component.html',
  styleUrl: './digital-book-user-report.component.scss'
})
export class DigitalBookUserReportComponent {
  private readonly libraryUserService = inject(LibraryUserService);
  private readonly groupService = inject(LibraryDiscussionGroupService);
  private readonly bookService = inject(LibraryBookService);
  private readonly purchasesService = inject(PurchasesService);

  readonly columns: DataGridColumn<DigitalBookUserRow>[] = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'signedUp', label: 'Signed Up', type: 'date', dateFormat: 'MMM d, y' },
    { key: 'lastLogin', label: 'Last Login', type: 'date', dateFormat: 'MMM d, y' },
    { key: 'licensedBookCount', label: 'Books', type: 'number' },
    { key: 'access', label: 'Access' },
    { key: 'bookTitles', label: 'Book Titles', cellClass: 'wide-cell' },
    { key: 'licensedVia', label: 'Licensed Via' },
    { key: 'coupon', label: 'Coupon' },
    { key: 'groupRole', label: 'Group Role' },
    { key: 'groups', label: 'Groups', cellClass: 'wide-cell' },
    { key: 'status', label: 'Status' }
  ];

  readonly loading = signal(true);
  readonly error = signal('');

  /** Default ON, per the report's brief: this is the DIGITAL BOOK users
   *  report, so the licensed/international population is the headline; the
   *  toggle opens it up to every `libraryUsers` row when you want the wider
   *  view (signed-up-but-never-bought accounts included). */
  readonly onlyWithBookAccess = signal(true);

  private readonly allRows = signal<DigitalBookUserRow[]>([]);

  readonly rows = computed<DigitalBookUserRow[]>(() =>
    this.onlyWithBookAccess() ? this.allRows().filter((row) => row.access !== 'None') : this.allRows()
  );

  readonly totalCount = computed(() => this.allRows().length);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      // Concurrent, not sequential - four independent reads, the slowest of
      // which (the whole `libraryUsers` collection) shouldn't wait on the
      // book scan. firstValueFrom on the two Observable-shaped sources takes
      // one snapshot and unsubscribes: a live feed on some sources but not
      // others would only ever produce a half-fresh join.
      const [users, groups, memberships, books] = await Promise.all([
        firstValueFrom(this.libraryUserService.getLibraryUsers()),
        firstValueFrom(this.groupService.getAllGroups()),
        this.groupService.getAllMemberships(),
        this.bookService.getAll()
      ]);

      const bookTitleById = new Map<string, string>();
      for (const book of books) {
        if (book.id) {
          bookTitleById.set(book.id, book.title);
        }
      }

      const couponByPurchaseId = await this.couponsForLicences(users);

      this.allRows.set(this.buildRows(users, groups, memberships, bookTitleById, couponByPurchaseId));
    } catch (e) {
      this.error.set('Could not load the report. ' + (e instanceof Error ? e.message : 'Please try again.'));
      this.allRows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Coupon code per purchase, for only the purchases a licence actually names.
   *
   * Fetched by id rather than by reading `purchases` whole: that collection is
   * into four figures and this report needs a handful of rows from it, so a
   * whole-collection scan here would cost more than the rest of the report put
   * together. It also grows with LICENCES, not with sales.
   *
   * A missing or unreadable purchase is skipped rather than failing the
   * report - a coupon is worth knowing, not worth losing every other column
   * over.
   */
  private async couponsForLicences(users: LibraryUser[]): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const user of users) {
      for (const licence of user.bookLicenses ?? []) {
        if (licence.storePurchaseId) {
          ids.add(licence.storePurchaseId);
        }
      }
    }

    const found = new Map<string, string>();
    await Promise.all([...ids].map(async (id) => {
      try {
        const purchase = await this.purchasesService.getById(id);
        const code = purchase?.couponCode?.trim();
        if (code) {
          found.set(id, code);
        }
      } catch {
        // Skipped on purpose - see the note above.
      }
    }));
    return found;
  }

  private buildRows(
    users: LibraryUser[],
    groups: DiscussionGroup[],
    memberships: GroupMembership[],
    bookTitleById: Map<string, string>,
    couponByPurchaseId: Map<string, string>
  ): DigitalBookUserRow[] {
    const groupTitleById = new Map<string, string>(groups.map((g) => [g.id, g.title]));

    // Groups this patron STARTED, keyed by creator email. The creator also
    // gets an 'approved' member doc of their own at creation time, so the
    // membership pass below has to skip groups already counted here, or every
    // leader would read as "Leader & Member" of their own single group.
    const ledByEmail = new Map<string, DiscussionGroup[]>();
    for (const group of groups) {
      const key = lower(group.creatorEmail);
      if (!key) {
        continue;
      }
      const list = ledByEmail.get(key);
      if (list) {
        list.push(group);
      } else {
        ledByEmail.set(key, [group]);
      }
    }

    const membershipsByEmail = new Map<string, GroupMembership[]>();
    for (const membership of memberships) {
      const key = lower(membership.email);
      if (!key) {
        continue;
      }
      const list = membershipsByEmail.get(key);
      if (list) {
        list.push(membership);
      } else {
        membershipsByEmail.set(key, [membership]);
      }
    }

    const rows = users.map((user) => {
      const key = lower(user.email || user.id);
      const led = ledByEmail.get(key) ?? [];
      const ledIds = new Set(led.map((g) => g.id));

      // 'rejected' requests are dropped outright: a turned-down request is
      // not belonging to a group in any sense this report is asking about.
      const own = (membershipsByEmail.get(key) ?? []).filter(
        (m) => !ledIds.has(m.groupId) && (m.status === 'approved' || m.status === 'pending')
      );
      const joined = own.filter((m) => m.status === 'approved');
      const pending = own.filter((m) => m.status === 'pending');

      const licensedBookIds = user.licensedBookIds ?? [];
      const isInternational = !!user.internationalUser;
      const access: BookAccess = isInternational ? 'International' : licensedBookIds.length > 0 ? 'Licensed' : 'None';

      return {
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        email: user.email || user.id,
        signedUp: user.createdAt ? new Date(user.createdAt) : null,
        lastLogin: user.lastLogin ? new Date(user.lastLogin) : null,
        licensedBookCount: licensedBookIds.length,
        bookTitles: this.bookTitlesLabel(licensedBookIds, isInternational, bookTitleById),
        access,
        licensedVia: this.licensedViaLabel(user.bookLicenses ?? []),
        coupon: this.couponLabel(user.bookLicenses ?? [], couponByPurchaseId),
        groupRole: this.groupRole(led.length, joined.length, pending.length),
        groups: this.groupsLabel(led, joined, pending, groupTitleById),
        status: user.revoked ? ('REVOKED' as const) : ('Active' as const)
      };
    });

    // Pre-sorted newest-first as well as handing the grid initialSortKey, so
    // the requested order still holds after someone clicks a header a third
    // time (which clears the grid's sort back to source order entirely).
    // A row with no createdAt sorts as 0/epoch, i.e. to the bottom.
    return rows.sort((a, b) => (b.signedUp?.getTime() ?? 0) - (a.signedUp?.getTime() ?? 0));
  }

  /** An international patron's licence array is beside the point - they read
   *  the whole catalog free - so say that rather than list whatever handful
   *  of ids they also happen to own. An unknown id falls back to the id
   *  itself rather than being dropped, so a book deleted out from under a
   *  live licence stays visible instead of silently shortening the list. */
  private bookTitlesLabel(
    licensedBookIds: string[],
    isInternational: boolean,
    bookTitleById: Map<string, string>
  ): string {
    if (isInternational) {
      return 'All books (international)';
    }
    return licensedBookIds.map((id) => bookTitleById.get(id) ?? id).join(', ');
  }

  /**
   * How this patron's licences were obtained, counted by source.
   *
   * Counted rather than listed, because a patron with nine books from the same
   * place should read as one fact, not nine. Sources are named the way staff
   * would say them out loud - "Purchased", "Comped" - rather than by their
   * stored slug.
   *
   * An entry with no source reads LEGACY, not blank and not a guess: it means
   * the licence predates provenance being recorded, which is a different thing
   * from having no licences at all.
   */
  private licensedViaLabel(licences: { source?: string }[]): string {
    if (!licences.length) {
      return '';
    }

    const LABELS: Record<string, string> = {
      'store-purchase': 'Purchased',
      'group-license': 'Group',
      'admin-grant': 'Comped'
    };

    const counts = new Map<string, number>();
    for (const licence of licences) {
      const label = LABELS[licence.source ?? ''] ?? 'Legacy';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    // Legacy last: it is the absence of an answer, so it should not lead.
    return [...counts.entries()]
      .sort((a, b) => (a[0] === 'Legacy' ? 1 : b[0] === 'Legacy' ? -1 : b[1] - a[1]))
      .map(([label, count]) => (counts.size === 1 && count === licences.length && label !== 'Legacy'
        ? label
        : `${label} (${count})`))
      .join(' · ');
  }

  /** The coupon codes on the purchases that granted these licences, deduped -
   *  someone who bought three books in one discounted order should see that
   *  code once, not three times. */
  private couponLabel(
    licences: { storePurchaseId?: string }[],
    couponByPurchaseId: Map<string, string>
  ): string {
    const codes = new Set<string>();
    for (const licence of licences) {
      const code = licence.storePurchaseId ? couponByPurchaseId.get(licence.storePurchaseId) : undefined;
      if (code) {
        codes.add(code);
      }
    }
    return [...codes].join(', ');
  }

  private groupRole(ledCount: number, joinedCount: number, pendingCount: number): GroupRole {
    if (ledCount && joinedCount) {
      return 'Leader & Member';
    }
    if (ledCount) {
      return 'Leader';
    }
    if (joinedCount) {
      return 'Member';
    }
    return pendingCount ? 'Pending' : '';
  }

  /** Led groups first, then joined, then outstanding requests - the order
   *  someone reads the cell in should match how much the row is "theirs". */
  private groupsLabel(
    led: DiscussionGroup[],
    joined: GroupMembership[],
    pending: GroupMembership[],
    groupTitleById: Map<string, string>
  ): string {
    const title = (groupId: string) => groupTitleById.get(groupId) ?? groupId;
    return [
      ...led.map((g) => `${g.title} (leads)`),
      ...joined.map((m) => `${title(m.groupId)} (member)`),
      ...pending.map((m) => `${title(m.groupId)} (pending)`)
    ].join(', ');
  }
}
