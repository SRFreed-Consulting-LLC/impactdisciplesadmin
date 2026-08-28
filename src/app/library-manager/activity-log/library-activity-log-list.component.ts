import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { SelectionModel } from '@angular/cdk/collections';
import { SharedModule } from 'src/app/shared/shared.module';
import { DataGridColumn, DataGridRowAction } from 'src/app/shared/data-grid/data-grid.model';
import { ListHeaderAction } from 'src/app/shared/list-header/list-header.component';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { LibraryActivityLogService } from 'src/app/common/services/data/library/library-activity-log.service';
import {
  LIBRARY_ACTIVITY_ACTION_LABELS,
  LibraryActivityAction,
  LibraryActivityLogEntry,
} from 'src/app/common/models/domain/library/library-activity-log.model';

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
  // SharedModule for <app-data-grid> - see lesson-templates-list.
  imports: [CommonModule, SharedModule],
  templateUrl: './library-activity-log-list.component.html',
  styleUrl: './library-activity-log-list.component.scss',
})
export class LibraryActivityLogListComponent {
  readonly actionLabels = LIBRARY_ACTIVITY_ACTION_LABELS;
  readonly columns: DataGridColumn<ActivityRow>[] = [
    { key: 'timestamp', label: 'When', type: 'date', dateFormat: 'MMM d, y, h:mm a' },
    { key: 'actorDisplayName', label: 'Who' },
    { key: 'actorEmail', label: 'Email' },
    { key: 'action', label: 'Action', value: (r) => this.actionLabel(r.action) },
    { key: 'targetName', label: 'Target' },
    { key: 'detail', label: 'Detail' },
  ];

  readonly headerActions: ListHeaderAction[] = [
    { label: 'Delete Selected', icon: 'delete_sweep', onClick: () => void this.deleteSelected() },
  ];

  readonly rowActions: DataGridRowAction<ActivityRow>[] = [
    { icon: 'delete_outline', tooltip: 'Delete', onClick: (r) => void this.deleteOne(r) },
  ];

  readonly loading = signal(true);

  /** The grid renders and drives the checkbox column from this - a CDK
   *  SelectionModel because that is what <app-data-grid> speaks
   *  (2026-08-21, bucket A item #1, replacing this module's own
   *  LibraryRowSelection util). Holds the ROWS; deleteSelected maps to ids. */
  readonly selection = new SelectionModel<ActivityRow>(true, []);

  private readonly events = signal<LibraryActivityLogEntry[]>([]);
  private readonly usersByUid = signal<ReadonlyMap<string, AdminUser>>(new Map());

  readonly rows = computed<ActivityRow[]>(() => {
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

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private activityLog: LibraryActivityLogService,
    private adminUserService: AdminUserService,
    private confirmService: ConfirmService,
  ) {
    this.adminUserService.getAll().then((users) => {
      this.usersByUid.set(new Map(users.map((u) => [u.firebaseUID, u])));
    });

    // takeUntilDestroyed is NOT optional here, and this is the most expensive
    // of the five sites the 2026-08-27 sweep found. getAllActivity() is a
    // collectionData() with limit(500): subscribing registers an onSnapshot
    // listener that detaches ONLY on unsubscribe, and this component mounts
    // behind an @if in library-manager.component.html, so it is destroyed and
    // re-created on every tab switch.
    //
    // Without teardown each visit left a live 500-document listener behind,
    // holding the destroyed component through this callback's closure and
    // re-reading - and re-BILLING - all 500 docs on every write to
    // activityLog, forever, to update a DOM that no longer exists. Ten tab
    // switches meant ten of them.
    //
    // The liveness itself is deliberate; do not "fix" this by converting to a
    // one-shot read. Only the teardown was missing.
    this.activityLog.getAllActivity().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((events) => {
      this.events.set(events);
      this.loading.set(false);
      const liveIds = new Set(events.map((e) => e.id));
      for (const row of this.selection.selected) {
        if (!liveIds.has(row.id)) {
          this.selection.deselect(row);
        }
      }
    });
  }

  actionLabel(action: LibraryActivityAction): string {
    return this.actionLabels[action];
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
    const ids = this.selection.selected.map((row) => row.id!);
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
