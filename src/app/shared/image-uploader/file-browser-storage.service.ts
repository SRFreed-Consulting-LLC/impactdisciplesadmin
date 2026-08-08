import { Injectable } from '@angular/core';
import { getApp } from 'firebase/app';
import {
  deleteObject,
  getBytes,
  getDownloadURL,
  getMetadata,
  getStorage,
  listAll,
  ref,
  StorageReference,
  uploadBytes,
  uploadString
} from 'firebase/storage';
import { FileItem } from 'impactdisciplescommon/src/models/utils/file-item.model';

// Firebase Storage has no real "directory" objects - a folder only exists
// as long as at least one real file sits under that path prefix. Every
// "New Directory" action here (and in the original DevExtreme-backed
// uploader) creates this hidden placeholder file so an otherwise-empty
// folder still shows up when its parent is listed.
const PLACEHOLDER_NAME = '---do not delete me---';

// Drop-in replacement for impactdisciplescommon's FileUploadService, moved
// into this app's own src/app/shared/ per the plan to retire
// app-image-uploader's DevExtreme dependency - but also genuinely fixes two
// real bugs found in that service along the way:
//   1. The placeholder file above was never filtered out of listings, so an
//      empty folder showed a fake "---do not delete me---" file inside it.
//   2. rename/move/copy/delete all worked by reading the item's own bytes
//      (getBytes(ref(item.path))) and writing/deleting that single blob -
//      which only ever works for files. A folder has no blob at its own
//      path (only its *contents* are real objects), so calling any of
//      those on a folder silently did nothing (rename/move/copy) or threw
//      (delete, since deleteObject on a path with no object at it errors).
//      Every folder operation here instead recurses through the folder's
//      real descendant files.
@Injectable({
  providedIn: 'root'
})
export class FileBrowserStorageService {
  private storage = getStorage(getApp());

  listFolder(path: string): Promise<FileItem[]> {
    return listAll(ref(this.storage, path)).then(async (res) => {
      const folders: FileItem[] = res.prefixes.map((folderRef) => {
        const item = new FileItem();
        item.isDirectory = true;
        item.name = folderRef.name;
        item.reference = folderRef;
        return item;
      });

      const files = await Promise.all(
        res.items
          .filter((itemRef) => itemRef.name !== PLACEHOLDER_NAME)
          .map((itemRef) => {
            const item = new FileItem();
            item.isDirectory = false;
            item.name = itemRef.name;
            item.reference = itemRef;
            return getMetadata(itemRef).then((metadata) => {
              item.size = metadata.size;
              item.timeCreated = metadata.updated;
              return item;
            });
          })
      );

      return [...folders, ...files];
    });
  }

  uploadFile(file: File, destinationPath: string): Promise<void> {
    const fileRef = ref(this.storage, this.join(destinationPath, file.name));
    return uploadBytes(fileRef, file).then(() => undefined);
  }

  createDirectory(parentPath: string, name: string): Promise<void> {
    const placeholderRef = ref(this.storage, this.join(this.join(parentPath, name), PLACEHOLDER_NAME));
    return uploadString(placeholderRef, PLACEHOLDER_NAME).then(() => undefined);
  }

  getDownloadUrl(item: FileItem): Promise<string> {
    return getDownloadURL(item.reference);
  }

  async deleteItem(item: FileItem): Promise<void> {
    if (item.isDirectory) {
      const files = await this.listAllFilesRecursive(item.reference.fullPath);
      await Promise.all(files.map((f) => deleteObject(f)));
    } else {
      await deleteObject(item.reference);
    }
  }

  async renameItem(item: FileItem, newName: string): Promise<void> {
    const parentPath = item.reference.parent?.fullPath ?? '';
    if (item.isDirectory) {
      await this.copyDirectory(item.reference.fullPath, parentPath, newName);
      await this.deleteItem(item);
    } else {
      await this.copyFile(item.reference, this.join(parentPath, newName));
      await deleteObject(item.reference);
    }
  }

  async moveItem(item: FileItem, destinationPath: string): Promise<void> {
    if (item.isDirectory) {
      await this.copyDirectory(item.reference.fullPath, destinationPath, item.name);
      await this.deleteItem(item);
    } else {
      await this.copyFile(item.reference, this.join(destinationPath, item.name));
      await deleteObject(item.reference);
    }
  }

  async copyItem(item: FileItem, destinationPath: string): Promise<void> {
    if (item.isDirectory) {
      await this.copyDirectory(item.reference.fullPath, destinationPath, item.name);
    } else {
      await this.copyFile(item.reference, this.join(destinationPath, item.name));
    }
  }

  private async copyFile(source: StorageReference, destinationPath: string): Promise<void> {
    const bytes = await getBytes(source);
    await uploadBytes(ref(this.storage, destinationPath), bytes);
  }

  private async copyDirectory(sourcePath: string, destinationParentPath: string, newName: string): Promise<void> {
    const destRoot = this.join(destinationParentPath, newName);
    const files = await this.listAllFilesRecursive(sourcePath);

    if (files.length === 0) {
      // Preserve an empty folder with the same placeholder trick used to
      // create one.
      await this.createDirectory(destinationParentPath, newName);
      return;
    }

    await Promise.all(
      files.map((f) => {
        const relativePath = f.fullPath.slice(sourcePath.length);
        return this.copyFile(f, destRoot + relativePath);
      })
    );
  }

  // Recurses through every sub-folder, returning every real file
  // (StorageReference) anywhere underneath `path` - folders themselves
  // never appear in this list since they aren't real objects.
  private async listAllFilesRecursive(path: string): Promise<StorageReference[]> {
    const res = await listAll(ref(this.storage, path));
    const nested = await Promise.all(res.prefixes.map((p) => this.listAllFilesRecursive(p.fullPath)));
    return [...res.items, ...nested.flat()];
  }

  private join(parentPath: string, name: string): string {
    return parentPath ? `${parentPath}/${name}` : name;
  }
}
