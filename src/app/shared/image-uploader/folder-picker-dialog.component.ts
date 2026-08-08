import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FileItem } from 'impactdisciplescommon/src/models/utils/file-item.model';
import { FileBrowserStorageService } from './file-browser-storage.service';

export interface FolderPickerDialogData {
  title: string;
  // The item being moved/copied - its own path (and, since a folder can't
  // be moved/copied into itself or any of its own descendants, every path
  // nested under it) is excluded from navigation.
  excludePath?: string;
}

@Component({
    selector: 'app-folder-picker-dialog',
    templateUrl: './folder-picker-dialog.component.html',
    styleUrls: ['./folder-picker-dialog.component.scss'],
    standalone: false
})
export class FolderPickerDialogComponent implements OnInit {
  currentPath = '';
  folders: FileItem[] = [];
  loading = true;

  constructor(
    private dialogRef: MatDialogRef<FolderPickerDialogComponent, string | false>,
    @Inject(MAT_DIALOG_DATA) public data: FolderPickerDialogData,
    private storage: FileBrowserStorageService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  get currentFolderLabel(): string {
    if (!this.currentPath) {
      return 'Files';
    }
    const parts = this.currentPath.split('/');
    return parts[parts.length - 1];
  }

  navigateInto(folder: FileItem): void {
    this.currentPath = folder.reference.fullPath;
    this.load();
  }

  navigateUp(): void {
    const idx = this.currentPath.lastIndexOf('/');
    this.currentPath = idx === -1 ? '' : this.currentPath.slice(0, idx);
    this.load();
  }

  isExcluded(folder: FileItem): boolean {
    if (!this.data.excludePath) {
      return false;
    }
    const path = folder.reference.fullPath;
    return path === this.data.excludePath || path.startsWith(this.data.excludePath + '/');
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSelectFolder(): void {
    this.dialogRef.close(this.currentPath);
  }

  private load(): void {
    this.loading = true;
    this.storage
      .listFolder(this.currentPath)
      .then((items) => {
        this.folders = items.filter((item) => item.isDirectory && !this.isExcluded(item));
      })
      .finally(() => {
        this.loading = false;
      });
  }
}
