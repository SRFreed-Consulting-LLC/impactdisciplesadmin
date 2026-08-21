import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SharedModule } from 'src/app/shared/shared.module';
import { MatDialog } from '@angular/material/dialog';
import { DataGridColumn, DataGridRowAction } from 'src/app/shared/data-grid/data-grid.model';
import { ListHeaderAction } from 'src/app/shared/list-header/list-header.component';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { LibrarySubtemplateService } from 'src/app/common/services/data/library/library-subtemplate.service';
import {
  LibrarySubtemplateModel,
  LibrarySubtemplateType,
} from 'src/app/common/models/domain/library/library-subtemplate.model';
import {
  SubtemplateCreateDialogComponent,
  SubtemplateCreateDialogResult,
} from './subtemplate-create-dialog.component';

const TYPE_LABELS: Record<LibrarySubtemplateType, string> = {
  header: 'Header',
  footer: 'Footer',
  layout: 'Layout',
};

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/subtemplates/subtemplates-list.component.ts. Adapted to this
 * app's tab-shell convention (a NavLeaf under Library Manager, not its own
 * top-level route with a "Back to library"/Help header of its own - see
 * LibraryManagerComponent). Uses this app's own ConfirmService instead of
 * porting a second confirm-dialog component.
 */
@Component({
  selector: 'app-subtemplates-list',
  standalone: true,
  // SharedModule for <app-data-grid> - see lesson-templates-list for the
  // full note on why a standalone component imports the module.
  imports: [CommonModule, SharedModule],
  templateUrl: './subtemplates-list.component.html',
  styleUrl: './subtemplates-list.component.scss',
})
export class SubtemplatesListComponent implements OnInit {
  subtemplates: LibrarySubtemplateModel[] = [];
  loading = true;

  readonly columns: DataGridColumn<LibrarySubtemplateModel>[] = [
    { key: 'title', label: 'Title' },
    { key: 'type', label: 'Type', value: (s) => this.typeLabel(s.type) },
    { key: 'fieldCount', label: 'Fields', type: 'number', value: (s) => this.fieldCount(s) },
  ];

  readonly headerActions: ListHeaderAction[] = [
    { label: 'New Subtemplate', icon: 'post_add', onClick: () => void this.createSubtemplate() },
  ];

  readonly rowActions: DataGridRowAction<LibrarySubtemplateModel>[] = [
    { icon: 'delete_outline', tooltip: 'Delete', onClick: (s) => void this.deleteSubtemplate(s) },
  ];

  constructor(
    private subtemplateService: LibrarySubtemplateService,
    private confirmService: ConfirmService,
    private dialog: MatDialog,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.subtemplateService.getAll().then((subtemplates) => {
      this.subtemplates = subtemplates;
      this.loading = false;
    });
  }

  fieldCount(subtemplate: LibrarySubtemplateModel): number {
    return subtemplate.formSchema?.components?.length ?? 0;
  }

  typeLabel(type: LibrarySubtemplateType | undefined): string {
    return type ? TYPE_LABELS[type] : '—';
  }

  openSubtemplate(subtemplate: LibrarySubtemplateModel): void {
    void this.router.navigate(['/library-manager/subtemplates', subtemplate.id]);
  }

  async createSubtemplate(): Promise<void> {
    const ref = this.dialog.open(SubtemplateCreateDialogComponent, { width: '400px' });
    const result: SubtemplateCreateDialogResult | undefined = await firstValueFrom(ref.afterClosed());
    if (!result) {
      return;
    }
    const subtemplateId = await this.subtemplateService.createSubtemplate(result.name, result.type);
    void this.router.navigate(['/library-manager/subtemplates', subtemplateId]);
  }

  // No Event argument - the grid owns the action button and rows open on
  // DOUBLE-click, so the old stopPropagation guard is unnecessary.
  async deleteSubtemplate(subtemplate: LibrarySubtemplateModel): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      `Delete the "${subtemplate.title}" subtemplate? This cannot be undone.`,
      'Delete subtemplate',
    );
    if (!confirmed) {
      return;
    }
    await this.subtemplateService.deleteSubtemplate(subtemplate.id!, subtemplate.title, subtemplate.type);
    this.load();
  }
}
