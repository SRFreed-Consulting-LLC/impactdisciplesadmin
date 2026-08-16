import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { LibraryDiscussionGroupService } from 'src/app/common/services/data/library/library-discussion-group.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { DiscussionGroup } from '@impact-common/models/discussion-group.model';
import {
  GroupWizardBook,
  GroupWizardDialogComponent,
  GroupWizardResult,
} from '@impact-common/groups/group-wizard-dialog.component';
import { groupLocationLabel } from '@impact-common/groups/group-location-label.util';

type MeetingType = 'in-person' | 'online' | 'hybrid';

interface GroupRow {
  group: DiscussionGroup;
  bookTitle: string;
  locationLabel: string | undefined;
  meetingType: MeetingType;
  memberCount: number;
  pendingCount: number;
}

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  'in-person': 'In-Person',
  online: 'Online',
  hybrid: 'Hybrid',
};

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/groups/groups-list.component.ts. Admin Impact Groups module -
 * lists every group regardless of status/visibility (unlike either app's
 * own user-facing Browse tab), searchable/filterable, edit (via the shared
 * GroupWizardDialogComponent) and a real hard-delete. Adapted to this app's
 * tab-shell convention (no "Back to library"/Help header - same adaptation
 * every other Slice 2-4 screen already made), uses this app's own
 * ConfirmService/SnackbarService.
 *
 * **No Cloud Functions needed** - unlike Library Users (the next, larger
 * part of this slice), both mutations here (updateGroup/deleteGroup) are
 * direct Firestore writes staff already have rules access to, ported as-is.
 *
 * Note ported faithfully from the source, not invented here: despite the
 * source component's own doc comment claiming "create/edit (both via the
 * shared wizard)", there is no create entry point anywhere in that
 * component or its template - only edit (click a row) and delete. Matched
 * exactly rather than added a create button that wasn't actually there.
 */
@Component({
  selector: 'app-library-groups-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './library-groups-list.component.html',
  styleUrl: './library-groups-list.component.scss',
})
export class LibraryGroupsListComponent {
  readonly displayedColumns = ['title', 'leader', 'members', 'book', 'location', 'type', 'actions'];

  meetingTypeLabel(type: MeetingType): string {
    return MEETING_TYPE_LABELS[type];
  }

  readonly loading = signal(true);
  readonly search = signal('');
  readonly typeFilter = signal<MeetingType | ''>('');
  readonly statusFilter = signal<'open' | 'closed' | ''>('');
  readonly visibilityFilter = signal<'public' | 'invite-only' | ''>('');

  private readonly groups = signal<DiscussionGroup[]>([]);
  private readonly books = signal<GroupWizardBook[]>([]);

  private readonly bookTitleById = computed(() => {
    const map = new Map<string, string>();
    for (const book of this.books()) {
      map.set(book.id, book.title);
    }
    return map;
  });

  private readonly rows = computed<GroupRow[]>(() => {
    return this.groups().map((group) => {
      const offersInPerson = !!(group.location || group.inPersonLocation);
      const offersOnline = !!group.onlineInfo;
      return {
        group,
        bookTitle: this.bookTitleById().get(group.bookId) ?? 'Unknown book',
        locationLabel: groupLocationLabel(group, { alwaysShowAddress: true }),
        meetingType:
          offersInPerson && offersOnline ? 'hybrid' : offersOnline ? 'online' : 'in-person',
        // Denormalized on the group doc by the reader app's own
        // onGroupMembershipCountChanged Cloud Function trigger, not
        // computed here from a fetched membership list - defaults to 0 for
        // a group created before that field existed and not yet
        // backfilled.
        memberCount: group.memberCount ?? 0,
        pendingCount: group.pendingCount ?? 0,
      };
    });
  });

  trackByGroupId(_index: number, row: GroupRow): string {
    return row.group.id;
  }

  readonly visibleRows = computed<GroupRow[]>(() => {
    const search = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    const status = this.statusFilter();
    const visibility = this.visibilityFilter();
    return this.rows().filter((row) => {
      if (type && row.meetingType !== type) {
        return false;
      }
      if (status && row.group.status !== status) {
        return false;
      }
      if (visibility) {
        const groupVisibility = row.group.groupVisibility ?? 'public';
        if (groupVisibility !== visibility) {
          return false;
        }
      }
      if (search) {
        const haystack = [
          row.group.title,
          row.group.creatorDisplayName,
          row.group.creatorEmail,
          row.bookTitle,
          row.locationLabel ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    });
  });

  constructor(
    private groupsService: LibraryDiscussionGroupService,
    private bookService: LibraryBookService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private dialog: MatDialog,
  ) {
    void this.load();
    // Groups are a live listener (matches the source app - the admin table
    // benefits from staying current without a manual refresh); books are a
    // one-shot fetch feeding the wizard's picker, same as every other
    // Library screen's book lookups in this app.
    this.groupsService.getAllGroups().subscribe((groups) => {
      this.groups.set(groups);
      this.loading.set(false);
    });
  }

  private async load(): Promise<void> {
    const books = await this.bookService.getAll();
    this.books.set(books.map((b) => ({ id: b.id!, title: b.title })));
  }

  async openEditDialog(group: DiscussionGroup): Promise<void> {
    // A live, exact count fetched for just this one group at the moment of
    // opening - unlike the admin table's row-level memberCount (a
    // denormalized counter that's fine to show slightly stale), this value
    // feeds directly into the wizard's maxMembers validation, so it needs
    // to be correct even for a group created before that counter existed
    // and not yet backfilled.
    const members = await firstValueFrom(this.groupsService.getGroupMembers(group.id));
    const currentApprovedMemberCount = members.filter(
      (m) => m.status === 'approved' && m.email !== group.creatorEmail,
    ).length;
    const ref = this.dialog.open(GroupWizardDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      autoFocus: false,
      restoreFocus: true,
      data: { books: this.books(), existingGroup: group, currentApprovedMemberCount },
    });
    const result: GroupWizardResult | undefined = await firstValueFrom(ref.afterClosed());
    if (!result) {
      return;
    }
    try {
      await this.groupsService.updateGroup(group.id, result);
      this.snackbar.success('Impact Group updated.');
    } catch {
      this.snackbar.error('Something went wrong saving changes. Please try again.');
    }
  }

  async deleteGroup(group: DiscussionGroup, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    const confirmed = await this.confirmService.confirm(
      `Permanently delete "${group.title}"? This removes its members, chat, and messages too, and cannot be undone.`,
      'Delete Impact Group',
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.groupsService.deleteGroup(group.id);
      this.snackbar.success('Impact Group deleted.');
    } catch {
      this.snackbar.error('Something went wrong deleting the group. Please try again.');
    }
  }
}
