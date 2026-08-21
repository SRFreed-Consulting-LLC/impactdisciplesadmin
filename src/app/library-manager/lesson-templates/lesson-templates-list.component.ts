import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SharedModule } from 'src/app/shared/shared.module';
import { MatDialog } from '@angular/material/dialog';
import { DataGridColumn, DataGridRowAction } from 'src/app/shared/data-grid/data-grid.model';
import { ListHeaderAction } from 'src/app/shared/list-header/list-header.component';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { LibraryLessonTemplateService } from 'src/app/common/services/data/library/library-lesson-template.service';
import { LibrarySubtemplateService } from 'src/app/common/services/data/library/library-subtemplate.service';
import { LibraryLessonTemplateModel } from 'src/app/common/models/domain/library/library-lesson-template.model';
import { CreateItemDialogComponent } from '../dialogs/create-item-dialog.component';

const DELETED_LABEL = '(deleted)';
const NONE_LABEL = '—';

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/lesson-templates/lesson-templates-list.component.ts. Adapted to
 * this app's tab-shell convention, same as SubtemplatesListComponent - see
 * that component's own doc comment.
 */
@Component({
  selector: 'app-lesson-templates-list',
  standalone: true,
  // SharedModule for <app-data-grid> (2026-08-21, bucket A item #1). The
  // grid is a declared/exported member of SharedModule rather than a
  // standalone component, so a standalone consumer imports the module.
  imports: [CommonModule, SharedModule],
  templateUrl: './lesson-templates-list.component.html',
  styleUrl: './lesson-templates-list.component.scss',
})
export class LessonTemplatesListComponent implements OnInit {
  lessonTemplates: LibraryLessonTemplateModel[] = [];
  loading = true;

  // A slot column shows the referenced subtemplate's TITLE, not its id -
  // slotLabel() also distinguishes "never set" from "points at something
  // that was deleted", which is why these go through value() rather than
  // binding the raw field.
  readonly columns: DataGridColumn<LibraryLessonTemplateModel>[] = [
    { key: 'title', label: 'Title' },
    { key: 'header', label: 'Header', value: (t) => this.slotLabel(t.headerSubtemplateId) },
    { key: 'layout', label: 'Layout', value: (t) => this.slotLabel(t.layoutSubtemplateId) },
    { key: 'footer', label: 'Footer', value: (t) => this.slotLabel(t.footerSubtemplateId) },
  ];

  readonly headerActions: ListHeaderAction[] = [
    { label: 'New Lesson Template', icon: 'post_add', onClick: () => void this.createLessonTemplate() },
  ];

  readonly rowActions: DataGridRowAction<LibraryLessonTemplateModel>[] = [
    { icon: 'delete_outline', tooltip: 'Delete', onClick: (t) => void this.deleteLessonTemplate(t) },
  ];

  private subtemplateTitlesById = new Map<string, string>();

  constructor(
    private lessonTemplateService: LibraryLessonTemplateService,
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
    Promise.all([this.lessonTemplateService.getAll(), this.subtemplateService.getAll()]).then(
      ([lessonTemplates, subtemplates]) => {
        this.lessonTemplates = lessonTemplates;
        this.subtemplateTitlesById = new Map(subtemplates.map((t) => [t.id!, t.title]));
        this.loading = false;
      },
    );
  }

  /** Slot id set but missing from this map means the referenced subtemplate
   *  was deleted, not that the slot was left unset. */
  slotLabel(subtemplateId: string | null): string {
    if (!subtemplateId) {
      return NONE_LABEL;
    }
    return this.subtemplateTitlesById.get(subtemplateId) ?? DELETED_LABEL;
  }

  openLessonTemplate(lessonTemplate: LibraryLessonTemplateModel): void {
    void this.router.navigate(['/library-manager/lesson-templates', lessonTemplate.id]);
  }

  async createLessonTemplate(): Promise<void> {
    const ref = this.dialog.open(CreateItemDialogComponent, {
      data: { title: 'New Lesson Template', label: 'Lesson template name' },
      width: '400px',
    });
    const name: string | undefined = await firstValueFrom(ref.afterClosed());
    if (!name) {
      return;
    }
    const lessonTemplateId = await this.lessonTemplateService.createLessonTemplate(name);
    void this.router.navigate(['/library-manager/lesson-templates', lessonTemplateId]);
  }

  // No Event argument any more: the grid owns the action button, and rows
  // open on DOUBLE-click, so a single click on Delete cannot also open the
  // template - the stopPropagation/preventDefault this used to need is
  // structurally unnecessary now.
  async deleteLessonTemplate(lessonTemplate: LibraryLessonTemplateModel): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      `Delete the "${lessonTemplate.title}" lesson template? This cannot be undone.`,
      'Delete lesson template',
    );
    if (!confirmed) {
      return;
    }
    await this.lessonTemplateService.deleteLessonTemplate(lessonTemplate.id!, lessonTemplate.title);
    this.load();
  }
}
