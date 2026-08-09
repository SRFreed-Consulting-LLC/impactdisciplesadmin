import { StorageReference } from "firebase/storage";

export class FileItem {
  name: string;
  isDirectory: boolean;
  size?: number;
  items?: FileItem[];
  reference: StorageReference;
  downloadUrl: string;
  timeCreated: string;
}
