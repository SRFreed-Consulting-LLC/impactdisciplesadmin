import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { LibraryActivityLogService } from 'src/app/common/services/data/library/library-activity-log.service';
import {
  LIBRARY_ACTIVITY_ACTION_LABELS,
  LibraryActivityAction,
  LibraryActivityLogEntry,
} from 'src/app/common/models/domain/library/library-activity-log.model';
import {
  LibraryRowSelection,
  createLibraryRowSelection,
} from 'src/app/common/services/data/library/library-row-selection.util';

interface ActivityRow extends LibraryActivityLogEntry {
  /** Current display name/email from admin_users, falling back to the name
   *  snapshot stored on the entry itself (e.g. for a deleted account). */
  actorDisplayName: string;
  actorEmail: string;
}

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/events/events-list.component.ts. All-staff Library activity
 * log (account/access + content-edit audit trail, not view/read activity -
 * see LibraryActivityLogEntry). Filtering is entirely client-side, same
 * "fine at this scale" reasoning as the source's own screen.
 *
 * Named "Activity Log", not "Events" like the source app - this app
 * already has a real, unrelated "/events" section (physical calendar
 * events people sign up for), and the consolidation plan explicitly calls
 * out not colliding with it.
 */
@Component({
  selector: 'app-library-activity-log-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './library-activity-log-list.component.html',
  styleUrl: './library-activity-log-list.component.scss',
})
export class LibraryActivityLogListComponent {
  readonly actionLabels = LIBRARY_ACTIVITY_ACTION_LABELS;
  readonly actions = Object.keys(LIBRARY_ACTIVITY_ACTION_LABELS) as LibraryActivityAction[];

  readonly loading = signal(true);
  readonly search = signal('');
  readonly userFilter = signal('');
  readonly actionFilter = signal<LibraryActivityAction | ''>('');

  private readonly selection: LibraryRowSelection = createLibraryRowSelection();
  readonly selected = this.selection.selected;

  private readonly events = signal<LibraryActivityLogEntry[]>([]);
  private readonly usersByUid = signal<ReadonlyMap<string, AdminUser>>(new Map());

  private readonly rows = computed<ActivityRow[]>(() => {
    const users = this.usersByUid();
    return this.events().map((entry) => {
      const user = users.get(entry.actorUid);
      const userName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : '';
      return {
        ...entry,
        actorDisplayName: userName || entry.actorName,
        actorEmail: user?.email ?? '',
      };
    });
  });

  readonly actorOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const row of this.rows()) {
      if (!seen.has(row.actorUid)) {
        seen.set(row.actorUid, row.actorDisplayName);
      }
    }
    return [...seen.entries()]
      .map(([uid, name]) => ({ uid, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly visibleRows = computed<ActivityRow[]>(() => {
    const search = this.search().trim().toLowerCase();
    const userFilter = this.userFilter();
    const actionFilter = this.actionFilter();
    return this.rows().filter((row) => {
      if (userFilter && row.actorUid !== userFilter) {
        return false;
      }
      if (actionFilter && row.action !== actionFilter) {
        return false;
      }
      if (search) {
        const haystack = [
          row.actorDisplayName,
          row.actorEmail,
          this.actionLabels[row.action],
          row.targetName ?? '',
          row.detail ?? '',
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

  readonly allVisibleSelected = computed(() =>
    this.selection.allVisibleSelected(this.visibleRows().map((row) => row.id!)),
  );

  constructor(
    private activityLog: LibraryActivityLogService,
    private adminUserService: AdminUserService,
    private confirmService: ConfirmService,
  ) {
    this.adminUserService.getAll().then((users) => {
      this.usersByUid.set(new Map(users.map((u) => [u.firebaseUID, u])));
    });

    this.activityLog.getAllActivity().subscribe((events) => {
      this.events.set(events);
      this.loading.set(false);
      this.selection.pruneToLiveIds(events.map((e) => e.id!));
    });
  }

  actionLabel(action: LibraryActivityAction): string {
    return this.actionLabels[action];
  }

  isSelected(id: string): boolean {
    return this.selection.isSelected(id);
  }

  toggleRow(id: string, event: MatCheckboxChange): void {
    this.selection.toggle(id, event.checked);
  }

  toggleSelectAllVisible(): void {
    this.selection.toggleAllVisible(this.visibleRows().map((row) => row.id!));
  }

  async deleteOne(row: ActivityRow): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      `Delete this "${this.actionLabel(row.action)}" event?`,
      'Delete event',
    );
    if (!confirmed) {
      return;
    }
    await this.activityLog.deleteEntry(row.id!);
  }

  async deleteSelected(): Promise<void> {
    const ids = [...this.selected()];
    if (ids.length === 0) {
      return;
    }
    const confirmed = await this.confirmService.confirm(
      `Delete ${ids.length} selected events? This cannot be undone.`,
      'Delete selected events',
    );
    if (!confirmed) {
      return;
    }
    await this.activityLog.deleteEntries(ids);
    this.selection.clear();
  }
}
