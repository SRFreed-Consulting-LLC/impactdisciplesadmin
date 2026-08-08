import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FileItem } from 'impactdisciplescommon/src/models/utils/file-item.model';
import { FileBrowserStorageService } from './file-browser-storage.service';

// One row of the left-hand folder tree (see image-uploader.component) - a
// self-referencing component, the standard Angular way to render an
// arbitrarily-deep recursive structure. Children are fetched lazily (only
// once expanded), matching the original DevExtreme file manager's tree.
@Component({
    selector: 'app-file-tree-node',
    templateUrl: './file-tree-node.component.html',
    styleUrls: ['./file-tree-node.component.scss'],
    standalone: false
})
export class FileTreeNodeComponent {
  @Input() folderPath = '';
  @Input() folderName = 'Files';
  @Input() depth = 0;
  @Input() selectedPath = '';
  // Bumped by the parent whenever a change (new folder, rename, delete,
  // move) might have altered this node's own children - forces a re-fetch
  // the next time it's expanded rather than trusting a stale cached list.
  @Input() refreshToken = 0;
  @Output() folderSelected = new EventEmitter<string>();

  expanded = false;
  loading = false;
  children: FileItem[] | null = null;

  private lastRefreshToken = 0;

  constructor(private storage: FileBrowserStorageService) {}

  ngOnChanges(): void {
    if (this.refreshToken !== this.lastRefreshToken) {
      this.lastRefreshToken = this.refreshToken;
      this.children = null;
      if (this.expanded) {
        this.loadChildren();
      }
    }
  }

  toggle(event: Event): void {
    event.stopPropagation();
    if (!this.expanded && this.children === null) {
      this.loadChildren();
    }
    this.expanded = !this.expanded;
  }

  select(): void {
    this.folderSelected.emit(this.folderPath);
  }

  onChildSelected(path: string): void {
    this.folderSelected.emit(path);
  }

  childPath(child: FileItem): string {
    return child.reference.fullPath;
  }

  private loadChildren(): void {
    this.loading = true;
    this.storage
      .listFolder(this.folderPath)
      .then((items) => {
        this.children = items.filter((item) => item.isDirectory);
      })
      .finally(() => {
        this.loading = false;
      });
  }
}
