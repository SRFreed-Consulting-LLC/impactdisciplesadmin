import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  LibraryUnsavedChangesDialogComponent,
  LibraryUnsavedChangesDialogResult,
} from './library-unsaved-changes-dialog.component';

// PROOF OF PATTERN for `inject()`-style classes (2026-08-21).
//
// This component takes everything through field-initializer `inject()` and
// has no constructor at all, so `new LibraryUnsavedChangesDialogComponent()`
// throws NG0203 - inject() only works inside an Angular injection context.
// That does NOT make it untestable, and it does NOT require the heavyweight
// TestBed treatment (compileComponents + createComponent) that pulls in
// template compilation and every module import.
//
// TestBed is used here purely as an INJECTOR:
//   - configureTestingModule() registers fakes for the tokens it injects
//   - runInInjectionContext() opens the context so inject() resolves
//   - the class is still constructed with `new`, and NO template renders
//
// Cost versus the constructor-injection style used elsewhere in this repo
// (see permission.service.spec.ts, data-grid.component.spec.ts): three extra
// lines of setup, and deps are declared as providers instead of positional
// constructor arguments. Not a barrier - just a different shape.
//
// The one real trade-off: a missing provider is a runtime NullInjectorError
// rather than a TypeScript arity error, so it is caught when the test runs
// rather than when it compiles.

describe('LibraryUnsavedChangesDialogComponent', () => {
  /** Records what the component closed the dialog with. */
  function setup(itemLabel = 'lesson') {
    const closed: Array<LibraryUnsavedChangesDialogResult | undefined> = [];
    const dialogRef = { close: (r?: LibraryUnsavedChangesDialogResult) => closed.push(r) };

    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { itemLabel } },
      ],
    });

    const component = TestBed.runInInjectionContext(
      () => new LibraryUnsavedChangesDialogComponent());
    return { component, closed };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('constructs without rendering a template', () => {
    const { component } = setup();
    expect(component).toBeTruthy();
  });

  it('exposes the injected dialog data for the template to interpolate', () => {
    const { component } = setup('subtemplate');
    expect(component.data.itemLabel).toBe('subtemplate');
  });

  it('closes with save when the author chooses to keep their changes', () => {
    const { component, closed } = setup();
    component.choose('save');
    expect(closed).toEqual(['save']);
  });

  it('closes with discard when the author throws them away', () => {
    const { component, closed } = setup();
    component.choose('discard');
    expect(closed).toEqual(['discard']);
  });

  it('closes with nothing at all on cancel, so the caller can tell it apart', () => {
    // The guard distinguishes "discard" (leave, losing changes) from
    // "dismissed" (stay put) - closing cancel with a value would strand the
    // author on a page they asked to stay on, or navigate one they didn't.
    const { component, closed } = setup();
    component.cancel();
    expect(closed).toEqual([undefined]);
  });
});
