import { Injectable, Input } from '@angular/core';
import { DxFileManagerComponent } from 'devextreme-angular';
import FileSystemItem from 'devextreme/file_management/file_system_item';
import UploadInfo from 'devextreme/file_management/upload_info';
import { initializeApp } from 'firebase/app';
import { getStorage, ref, listAll, getMetadata, uploadBytes, deleteObject, uploadString, UploadResult, getBlob, getBytes, getDownloadURL  } from "firebase/storage";
import { environment } from 'src/environments/environment';
import { FileItem } from '../models/utils/file-item.model';

@Injectable({
  providedIn: 'root'
})
export class FileManagerService {
  public fileManager: DxFileManagerComponent;

  storage = getStorage(initializeApp(environment.firebaseConfig));

  @Input('height') height: string = '90%';

  constructor() { }

  getAllFileItems(parentDirectory: FileSystemItem){
    const imagesRef = ref(this.storage, parentDirectory.path);

    return listAll(imagesRef)
        .then(async (res) => {
          let fileItems: FileItem[] = [];

          let promisesMetaData: Promise<any>[] = [];

          res.prefixes.forEach((folderRef) => {
            let folderItem: FileItem = new FileItem();
            folderItem.isDirectory = true;
            folderItem.name = folderRef.name;
            folderItem.reference = folderRef;
            fileItems.push(folderItem);
          });

          res.items.forEach((itemRef) => {
            let documentItem: FileItem = new FileItem();
            documentItem.isDirectory = false;
            documentItem.name = itemRef.name;
            documentItem.reference = itemRef;

            promisesMetaData.push(getMetadata(itemRef).then(metadata => {
              documentItem.size = metadata.size;
              documentItem.timeCreated = metadata.updated;
              return documentItem;
            }))
          });

          await Promise.all(promisesMetaData).then(results => {
            results.forEach(result => {
              fileItems.push(result);
            })
          });

          return fileItems;
      })
  }

  uploadFile(file: File, destinationDirectory: FileSystemItem){
    const storageRef = ref(this.storage, destinationDirectory.path + "/" + file.name);

    return uploadBytes(storageRef, file)
  }

  deleteFile(item: FileSystemItem){
    const imagesRef = ref(this.storage, item.path);

    return deleteObject(imagesRef)
  }

  renameItem(item: FileSystemItem, newName: string): any {
    const imagesRef = ref(this.storage, item.path);

    return getBytes(imagesRef).then(b => {
      const newImageRef = ref(this.storage, item['parentPath'] + '/' + newName);

      return uploadBytes(newImageRef, b).then(result => {
        return deleteObject(imagesRef);
      })
    }).catch((error) => {
      console.error(error)
    });
  }

  createDirectory(parentDirectory: FileSystemItem, name: string): Promise<UploadResult> {
    const storageRef = ref(this.storage, parentDirectory.path + "/" + name + "/---do not delete me---");

    return uploadString(storageRef, '---do not delete me---')
  }

  moveItem(item: FileSystemItem, destinationDirectory: FileSystemItem): any {
    const imagesRef = ref(this.storage, item.path);

    return getBytes(imagesRef).then(b => {
      const newImageRef = ref(this.storage, destinationDirectory.path + '/' + item.name);

      return uploadBytes(newImageRef, b).then(() => {
        return deleteObject(imagesRef);
      })
    }).catch((error) => {
      console.error(error)
    });
  }

  copyItem(item: FileSystemItem, destinationDirectory: FileSystemItem): any {
    const imagesRef = ref(this.storage, item.path);

    return getBytes(imagesRef).then(b => {
      const newImageRef = ref(this.storage, destinationDirectory.path + '/' + item.name);

      return uploadBytes(newImageRef, b)
    }).catch((error) => {
      console.error(error)
    });
  }

  getFileUrl(item: FileSystemItem) : Promise<string>{
    const imagesRef = ref(this.storage, item.path);
    return getDownloadURL(imagesRef);

  }
}
