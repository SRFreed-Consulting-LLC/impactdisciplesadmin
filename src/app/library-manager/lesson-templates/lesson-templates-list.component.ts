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
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTableModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './lesson-templates-list.component.html',
  styleUrl: './lesson-templates-list.component.scss',
})
export class LessonTemplatesListComponent implements OnInit {
  readonly displayedColumns = ['title', 'header', 'layout', 'footer', 'actions'];
  lessonTemplates: LibraryLessonTemplateModel[] = [];
  loading = true;

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

  trackByTemplateId(_index: number, template: LibraryLessonTemplateModel): string {
    return template.id!;
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

  async deleteLessonTemplate(lessonTemplate: LibraryLessonTemplateModel, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
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
