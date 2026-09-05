import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { FileItem } from 'src/app/common/models/utils/file-item.model';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { FileBrowserStorageService } from './file-browser-storage.service';
import { ImageUploaderComponent } from './image-uploader.component';

// TestBed as an INJECTOR only - no compileComponents/createComponent, so no
// template renders. Resolves constructor params and `inject()` fields alike,
// so this spec survives the file's later conversion to `inject()`.
//
// The file browser is shared by every screen that picks an image (products,
// home page images, team, podcasts, the email designer). Its selection and
// navigation rules are pure class logic, and none of them need Storage.

function item(name: string, isDirectory = false, fullPath = name): FileItem {
  return {
    name,
    isDirectory,
    reference: { fullPath } as FileItem['reference'],
    downloadUrl: '',
    timeCreated: '',
  } as FileItem;
}

/** Records what was listed, and replays canned folder contents. */
function fakeStorage(contents: FileItem[] = []) {
  const listed: string[] = [];
  return {
    listed,
    contents,
    listFolder(path: string): Promise<FileItem[]> {
      listed.push(path);
      return Promise.resolve(this.contents);
    },
  };
}

function makeComponent(storage = fakeStorage()): ImageUploaderComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ImageUploaderComponent,
      { provide: FileBrowserStorageService, useValue: storage },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => ({ subscribe: () => undefined }) }) } },
      { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      { provide: SnackbarService, useValue: { success: () => undefined, error: () => undefined, somethingWentWrong: () => undefined } },
    ],
  });
  return TestBed.inject(ImageUploaderComponent);
}

const clickEvent = (mods: Partial<MouseEvent> = {}) =>
  ({ stopPropagation: () => undefined, ctrlKey: false, metaKey: false, ...mods }) as MouseEvent;

describe('ImageUploaderComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('folder label', () => {
    it('calls the storage root "Files" rather than showing an empty crumb', () => {
      const component = makeComponent();
      component.currentPath = '';
      expect(component.currentFolderLabel).toBe('Files');
    });

    it('shows only the last segment of a nested path', () => {
      const component = makeComponent();
      component.currentPath = 'images/products/2026';
      expect(component.currentFolderLabel).toBe('2026');
    });
  });

  describe('icons', () => {
    it('uses a folder icon for directories, whatever they are named', () => {
      const component = makeComponent();
      expect(component.iconFor(item('photo.png', true))).toBe('folder');
    });

    it('uses an image icon for recognised image extensions', () => {
      const component = makeComponent();
      for (const name of ['a.jpg', 'b.JPEG', 'c.png', 'd.gif', 'e.webp', 'f.svg', 'g.bmp', 'h.avif']) {
        expect(component.iconFor(item(name))).withContext(name).toBe('image');
      }
    });

    it('uses a generic file icon for anything else', () => {
      const component = makeComponent();
      expect(component.iconFor(item('notes.pdf'))).toBe('insert_drive_file');
      expect(component.iconFor(item('archive.zip'))).toBe('insert_drive_file');
    });

    it('treats a name with no extension as a plain file', () => {
      const component = makeComponent();
      expect(component.isImage(item('README'))).toBeFalse();
    });

    it('matches extensions case-insensitively', () => {
      const component = makeComponent();
      expect(component.isImage(item('LOGO.PNG'))).toBeTrue();
    });
  });

  describe('view mode', () => {
    it('toggles between list and grid and back', () => {
      const component = makeComponent();
      const first = component.viewMode;
      component.toggleView();
      expect(component.viewMode).not.toBe(first);
      component.toggleView();
      expect(component.viewMode).toBe(first);
    });
  });

  describe('selection', () => {
    it('single click replaces the selection', () => {
      const component = makeComponent();
      const a = item('a.png');
      const b = item('b.png');
      component.onRowClick(a, clickEvent());
      component.onRowClick(b, clickEvent());
      expect(component.selectedItems.length).toBe(1);
      expect(component.isSelected(b)).toBeTrue();
      expect(component.isSelected(a)).toBeFalse();
    });

    it('ctrl-click adds to the selection in multiple mode', () => {
      const component = makeComponent();
      component.selectionMode = 'multiple';
      component.onRowClick(item('a.png'), clickEvent());
      component.onRowClick(item('b.png'), clickEvent({ ctrlKey: true }));
      expect(component.selectedItems.length).toBe(2);
    });

    it('cmd-click behaves the same, for macOS', () => {
      const component = makeComponent();
      component.selectionMode = 'multiple';
      component.onRowClick(item('a.png'), clickEvent());
      component.onRowClick(item('b.png'), clickEvent({ metaKey: true }));
      expect(component.selectedItems.length).toBe(2);
    });

    it('ctrl-clicking an already-selected item deselects just that one', () => {
      const component = makeComponent();
      component.selectionMode = 'multiple';
      const a = item('a.png');
      const b = item('b.png');
      component.onRowClick(a, clickEvent());
      component.onRowClick(b, clickEvent({ ctrlKey: true }));
      component.onRowClick(a, clickEvent({ ctrlKey: true }));
      expect(component.selectedItems.length).toBe(1);
      expect(component.isSelected(b)).toBeTrue();
    });

    it('ignores ctrl in single-selection mode', () => {
      const component = makeComponent();
      component.selectionMode = 'single';
      component.onRowClick(item('a.png'), clickEvent());
      component.onRowClick(item('b.png'), clickEvent({ ctrlKey: true }));
      expect(component.selectedItems.length).toBe(1);
    });

    it('identifies selection by storage path, not by object identity', () => {
      // Items are rebuilt on every folder load, so a re-listed file is a
      // different object - comparing references would drop the selection.
      const component = makeComponent();
      component.onRowClick(item('a.png', false, 'images/a.png'), clickEvent());
      expect(component.isSelected(item('a.png', false, 'images/a.png'))).toBeTrue();
    });

    it('clears the selection on demand', () => {
      const component = makeComponent();
      component.onRowClick(item('a.png'), clickEvent());
      component.clearSelection();
      expect(component.selectedItems).toEqual([]);
    });
  });

  describe('navigation', () => {
    it('double-clicking a folder navigates into it and clears the selection', () => {
      const storage = fakeStorage();
      const component = makeComponent(storage);
      component.onRowClick(item('a.png'), clickEvent());

      component.onRowDoubleClick(item('products', true, 'images/products'));

      expect(component.currentPath).toBe('images/products');
      expect(component.selectedItems).toEqual([]);
      expect(storage.listed).toContain('images/products');
    });

    it('double-clicking a file does not navigate', () => {
      const component = makeComponent();
      component.currentPath = 'images';
      component.onRowDoubleClick(item('a.png', false, 'images/a.png'));
      expect(component.currentPath).toBe('images');
    });

    // These three used to assert the BUCKET root, which is where this
    // picker opened until 2026-09-04. It is rooted at the tenant now - see
    // the `root` input - so "the root" means that folder, and the picker
    // must not climb out of it.

    it('navigating up drops one path segment', () => {
      const component = makeComponent();
      component.root = 'images';
      component.currentPath = 'images/products/2026';
      component.navigateUp();
      expect(component.currentPath).toBe('images/products');
    });

    it('navigating up from a top-level folder lands at the root', () => {
      const component = makeComponent();
      component.root = 'images';
      component.currentPath = 'images/products';
      component.navigateUp();
      expect(component.currentPath).toBe('images');
    });

    it('navigating up from the root stays at the root', () => {
      const component = makeComponent();
      component.root = 'images';
      component.currentPath = 'images';
      component.navigateUp();
      expect(component.currentPath).toBe('images');
    });

    it('CANNOT be walked out of its root, however deep the path looks', () => {
      // The guard that matters. A path shorter than the root can only mean
      // the walk has left it - without this the picker would surface another
      // tenant's files, or the bucket root, one Up click at a time.
      const component = makeComponent();
      component.root = 'tenants/impactdisciples.com';
      component.currentPath = 'tenants/impactdisciples.com/Web-Pages';

      component.navigateUp();
      expect(component.currentPath).toBe('tenants/impactdisciples.com');

      component.navigateUp();
      expect(component.currentPath).toBe('tenants/impactdisciples.com');
      expect(component.atRoot).toBeTrue();
    });

    it('opens at its root rather than wherever the bucket starts', () => {
      // Uploads land in currentPath, so where this OPENS is where a file
      // goes for anyone who does not navigate first - which is most people.
      const component = makeComponent();
      component.root = 'tenants/impactdisciples.com';
      component.ngOnInit();

      expect(component.currentPath).toBe('tenants/impactdisciples.com');
    });

    it('still allows the whole bucket when a screen asks for it', () => {
      // The store's files have not moved under the tenant yet, so those
      // screens pass root="" - see products.component.html.
      const component = makeComponent();
      component.root = '';
      component.currentPath = 'Store';

      component.navigateUp();
      expect(component.currentPath).toBe('');
      expect(component.atRoot).toBeTrue();
    });

    it('selecting a folder in the tree jumps straight to it', () => {
      const storage = fakeStorage();
      const component = makeComponent(storage);
      component.onTreeFolderSelected('images/team');
      expect(component.currentPath).toBe('images/team');
      expect(storage.listed).toContain('images/team');
    });
  });

  describe('listing', () => {
    it('sorts folders before files, each alphabetically', async () => {
      const storage = fakeStorage([
        item('zebra.png'),
        item('Beta', true),
        item('alpha.png'),
        item('Alpha', true),
      ]);
      const component = makeComponent(storage);
      component.refresh();
      await Promise.resolve();
      await Promise.resolve();

      expect(component.items.map((i) => i.name)).toEqual(['Alpha', 'Beta', 'alpha.png', 'zebra.png']);
    });

    it('clears the loading flag once the listing resolves', async () => {
      const component = makeComponent(fakeStorage([item('a.png')]));
      component.refresh();
      await Promise.resolve();
      await Promise.resolve();
      expect(component.loading).toBeFalse();
    });
  });

  describe('context menu', () => {
    it('remembers which item was right-clicked', () => {
      const component = makeComponent();
      const target = item('a.png');
      component.setContextItem(target, { stopPropagation: () => undefined } as Event);
      expect(component.contextMenuItem).toBe(target);
    });
  });
});
