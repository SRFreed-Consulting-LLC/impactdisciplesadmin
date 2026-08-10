import { Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { FileItem } from 'src/app/common/models/utils/file-item.model';
import { FileBrowserStorageService } from './file-browser-storage.service';
import { NewFolderDialogComponent } from './new-folder-dialog.component';
import { RenameDialogComponent } from './rename-dialog.component';
import { FolderPickerDialogComponent } from './folder-picker-dialog.component';
import { ConfirmService } from '../confirm-dialog/confirm.service';
import { SnackbarService } from '../snackbar.service';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'];

// Material replacement for the DevExtreme dx-file-manager-backed
// app-image-uploader (impactdisciplescommon) - same public API (card/
// field/isList/selectionMode/imageSelectVisible/imageSelectClosed) so it's
// a drop-in swap at every call site, backed by FileBrowserStorageService
// (this file's own sibling, not the submodule's FileUploadService - see
// its comment for the real bugs fixed along the way).
//
// One behavior change from the original, called out because it's a real
// fix rather than a stylistic one: the original applied whatever was
// clicked to `card[field]` immediately on selection, and both "Select" and
// "Cancel" just closed the popup (identically - Cancel never actually
// discarded anything). Here, clicking a row only highlights it; the
// original value is snapshotted when the picker opens, "Select" commits
// the highlighted item(s) to card[field], and "Cancel" restores the
// snapshot - so Cancel now actually cancels.
@Component({
    selector: 'app-image-uploader',
    templateUrl: './image-uploader.component.html',
    styleUrls: ['./image-uploader.component.scss'],
    standalone: false
})
export class ImageUploaderComponent implements OnInit {
  @Input() imageSelectVisible = true;
  @Output() imageSelectClosed = new EventEmitter<boolean>();

  @Input() card: Record<string, unknown>;
  @Input() field: string;
  @Input() isList: boolean;
  @Input() selectionMode: 'single' | 'multiple' = 'single';
  // The original's own dx-popup hardcoded width="800" height="700" in its
  // template rather than actually binding these to the @Input()s it
  // declared (its `height` input defaulted to 450 but was never applied
  // anywhere - dead code) - these defaults match what the popup actually
  // rendered at, not that unused default.
  @Input() width = 800;
  @Input() height = 700;

  @ViewChild('fileInput') fileInput: ElementRef<HTMLInputElement>;

  currentPath = '';
  items: FileItem[] = [];
  loading = true;
  uploading = false;
  viewMode: 'list' | 'grid' = 'list';
  dragOver = false;

  selectedItems: FileItem[] = [];
  contextMenuItem: FileItem | null = null;
  contextMenuPosition = { x: 0, y: 0 };

  // Bumped after any mutation (new folder, rename, delete, move, copy) so
  // the left-hand tree re-fetches instead of showing a stale child list.
  treeRefreshToken = 0;

  private originalValue: unknown;

  constructor(
    private storage: FileBrowserStorageService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.originalValue = this.card ? this.card[this.field] : undefined;
    this.load();
  }

  get currentFolderLabel(): string {
    if (!this.currentPath) {
      return 'Files';
    }
    const parts = this.currentPath.split('/');
    return parts[parts.length - 1];
  }

  isSelected(item: FileItem): boolean {
    return this.selectedItems.some((s) => s.reference.fullPath === item.reference.fullPath);
  }

  iconFor(item: FileItem): string {
    if (item.isDirectory) {
      return 'folder';
    }
    return this.isImage(item) ? 'image' : 'insert_drive_file';
  }

  isImage(item: FileItem): boolean {
    const ext = item.name.split('.').pop()?.toLowerCase();
    return !!ext && IMAGE_EXTENSIONS.includes(ext);
  }

  toggleView(): void {
    this.viewMode = this.viewMode === 'list' ? 'grid' : 'list';
  }

  // Selection follows the original's single-click-selects behavior (not a
  // separate "open" gesture) - double-click on a folder navigates instead.
  // Event is MouseEvent | KeyboardEvent so this can also back a
  // (keydown.enter) binding for keyboard activation (accessibility) - both
  // event types carry the .stopPropagation()/.ctrlKey/.metaKey this method
  // actually uses.
  onRowClick(item: FileItem, event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();

    if (this.selectionMode === 'multiple' && (event.ctrlKey || event.metaKey)) {
      if (this.isSelected(item)) {
        this.selectedItems = this.selectedItems.filter((s) => s.reference.fullPath !== item.reference.fullPath);
      } else {
        this.selectedItems = [...this.selectedItems, item];
      }
    } else {
      this.selectedItems = [item];
    }
  }

  onRowDoubleClick(item: FileItem): void {
    if (item.isDirectory) {
      this.navigateInto(item);
    }
  }

  navigateInto(item: FileItem): void {
    this.currentPath = item.reference.fullPath;
    this.clearSelection();
    this.load();
  }

  navigateUp(): void {
    const idx = this.currentPath.lastIndexOf('/');
    this.currentPath = idx === -1 ? '' : this.currentPath.slice(0, idx);
    this.clearSelection();
    this.load();
  }

  onTreeFolderSelected(path: string): void {
    this.currentPath = path;
    this.clearSelection();
    this.load();
  }

  clearSelection(): void {
    this.selectedItems = [];
  }

  refresh(): void {
    this.load();
  }

  // Right-click: no natural trigger element at the cursor, so this
  // positions a hidden trigger at the click point and opens it manually -
  // see image-uploader.component.html's #contextMenuTrigger.
  onContextMenu(event: MouseEvent, item: FileItem, trigger: { openMenu: () => void }): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isSelected(item)) {
      this.selectedItems = [item];
    }
    this.contextMenuItem = item;
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
    trigger.openMenu();
  }

  // Row's own "..." button: matMenuTriggerFor positions the menu relative
  // to the button itself, no manual positioning needed.
  setContextItem(item: FileItem, event: Event): void {
    event.stopPropagation();
    if (!this.isSelected(item)) {
      this.selectedItems = [item];
    }
    this.contextMenuItem = item;
  }

  triggerUpload(): void {
    this.fileInput?.nativeElement.click();
  }

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (files.length) {
      this.uploadFiles(files);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (files.length) {
      this.uploadFiles(files);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(): void {
    this.dragOver = false;
  }

  private uploadFiles(files: File[]): void {
    this.uploading = true;
    Promise.all(files.map((file) => this.storage.uploadFile(file, this.currentPath)))
      .then(() => {
        this.snackbar.success(files.length > 1 ? 'Files Uploaded' : 'File Uploaded');
        this.load();
      })
      .catch(() => this.snackbar.error('Some Error Occured'))
      .finally(() => (this.uploading = false));
  }

  showNewFolderDialog(): void {
    this.dialog
      .open(NewFolderDialogComponent, { width: '400px' })
      .afterClosed()
      .subscribe((name: string | false) => {
        if (!name) {
          return;
        }
        this.storage
          .createDirectory(this.currentPath, name)
          .then(() => {
            this.snackbar.success('Directory Created');
            this.treeRefreshToken++;
            this.load();
          })
          .catch(() => this.snackbar.error('Some Error Occured'));
      });
  }

  showRenameDialog(): void {
    const item = this.contextMenuItem ?? this.selectedItems[0];
    if (!item) {
      return;
    }
    this.dialog
      .open(RenameDialogComponent, { width: '400px', data: { currentName: item.name } })
      .afterClosed()
      .subscribe((newName: string | false) => {
        if (!newName || newName === item.name) {
          return;
        }
        this.storage
          .renameItem(item, newName)
          .then(() => {
            this.snackbar.success('Renamed');
            this.treeRefreshToken++;
            this.clearSelection();
            this.load();
          })
          .catch(() => this.snackbar.error('Some Error Occured'));
      });
  }

  showMoveDialog(): void {
    const item = this.contextMenuItem ?? this.selectedItems[0];
    if (!item) {
      return;
    }
    this.dialog
      .open(FolderPickerDialogComponent, {
        width: '480px',
        data: { title: 'MOVE TO', excludePath: item.isDirectory ? item.reference.fullPath : undefined }
      })
      .afterClosed()
      .subscribe((destinationPath: string | false) => {
        if (destinationPath === false || destinationPath === undefined) {
          return;
        }
        if (destinationPath === (item.reference.parent?.fullPath ?? '')) {
          return;
        }
        this.storage
          .moveItem(item, destinationPath)
          .then(() => {
            this.snackbar.success('Moved');
            this.treeRefreshToken++;
            this.clearSelection();
            this.load();
          })
          .catch(() => this.snackbar.error('Some Error Occured'));
      });
  }

  showCopyDialog(): void {
    const item = this.contextMenuItem ?? this.selectedItems[0];
    if (!item) {
      return;
    }
    this.dialog
      .open(FolderPickerDialogComponent, {
        width: '480px',
        data: { title: 'COPY TO', excludePath: item.isDirectory ? item.reference.fullPath : undefined }
      })
      .afterClosed()
      .subscribe((destinationPath: string | false) => {
        if (destinationPath === false || destinationPath === undefined) {
          return;
        }
        this.storage
          .copyItem(item, destinationPath)
          .then(() => {
            this.snackbar.success('Copied');
            this.treeRefreshToken++;
            this.clearSelection();
            this.load();
          })
          .catch(() => this.snackbar.error('Some Error Occured'));
      });
  }

  deleteSelected(): void {
    const items = this.contextMenuItem ? [this.contextMenuItem] : this.selectedItems;
    if (!items.length) {
      return;
    }
    const message =
      items.length === 1
        ? `<i>Are you sure you want to delete "${items[0].name}"?</i>`
        : `<i>Are you sure you want to delete these ${items.length} items?</i>`;

    this.confirmService.confirm(message, 'Confirm').then((confirmed) => {
      if (!confirmed) {
        return;
      }
      Promise.all(items.map((item) => this.storage.deleteItem(item)))
        .then(() => {
          this.snackbar.success('Deleted');
          this.treeRefreshToken++;
          this.clearSelection();
          this.load();
        })
        .catch(() => this.snackbar.error('Some Error Occured'));
    });
  }

  downloadSelected(): void {
    const items = this.contextMenuItem ? [this.contextMenuItem] : this.selectedItems;
    items
      .filter((item) => !item.isDirectory)
      .forEach((item) => {
        this.storage.getDownloadUrl(item).then((url) => {
          const link = document.createElement('a');
          link.href = url;
          link.download = item.name;
          link.target = '_blank';
          document.body.appendChild(link);
          link.click();
          link.remove();
        });
      });
  }

  canConfirm(): boolean {
    return this.selectedItems.some((item) => !item.isDirectory);
  }

  onSelectConfirm(): void {
    const files = this.selectedItems.filter((item) => !item.isDirectory);
    if (!files.length || !this.card) {
      this.closeWindow();
      return;
    }

    if (this.isList) {
      Promise.all(
        files.map((item) => this.storage.getDownloadUrl(item).then((url) => ({ name: item.name, url })))
      ).then((resolved) => {
        this.card[this.field] = resolved;
        this.closeWindow();
      });
    } else {
      this.storage.getDownloadUrl(files[0]).then((url) => {
        this.card[this.field] = { name: files[0].name, url };
        this.closeWindow();
      });
    }
  }

  onCancel(): void {
    if (this.card) {
      this.card[this.field] = this.originalValue;
    }
    this.closeWindow();
  }

  private closeWindow(): void {
    this.imageSelectVisible = false;
    this.imageSelectClosed.emit(false);
  }

  private load(): void {
    this.loading = true;
    this.storage
      .listFolder(this.currentPath)
      .then((items) => {
        this.items = items.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      })
      .finally(() => {
        this.loading = false;
      });
  }
}
