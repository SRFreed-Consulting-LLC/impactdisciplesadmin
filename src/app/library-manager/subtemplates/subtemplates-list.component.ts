import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
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
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTableModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './subtemplates-list.component.html',
  styleUrl: './subtemplates-list.component.scss',
})
export class SubtemplatesListComponent implements OnInit {
  readonly displayedColumns = ['title', 'type', 'fieldCount', 'actions'];
  subtemplates: LibrarySubtemplateModel[] = [];
  loading = true;

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

  trackBySubtemplateId(_index: number, subtemplate: LibrarySubtemplateModel): string {
    return subtemplate.id!;
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

  async deleteSubtemplate(subtemplate: LibrarySubtemplateModel, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
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
