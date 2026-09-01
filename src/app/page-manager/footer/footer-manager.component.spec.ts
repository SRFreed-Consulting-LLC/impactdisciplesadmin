import { FooterManagerComponent } from './footer-manager.component';

/**
 * THE SHELL ANSWERS THE UNSAVED-CHANGES GUARD.
 *
 * The guard is attached to the /footer ROUTE and calls hasUnsavedChanges()
 * on whatever component that route resolves to. That was the footer editor
 * until the docking bar moved in and a shell took the route - and the moment
 * it did, the call landed on a component with no such method.
 *
 * A guard that THROWS cancels the navigation, so the symptom was not an
 * error message: clicking "Docking Bar" simply did nothing. Shane found it
 * within a minute of the deploy.
 *
 * Hand-constructed: the shell's own DI is the base class's, and none of it
 * is reached by these two methods.
 */
describe('the footer shell answering the unsaved-changes guard', () => {
  const make = (footer?: { hasUnsavedChanges: () => boolean; save: () => Promise<void> }) => {
    const component = new FooterManagerComponent(
      null as never, null as never, null as never
    );
    (component as unknown as { footer: unknown }).footer = footer;
    return component;
  };

  it('answers for the footer editor when it is on screen', () => {
    expect(make({ hasUnsavedChanges: () => true, save: async () => undefined })
      .hasUnsavedChanges()).toBeTrue();

    expect(make({ hasUnsavedChanges: () => false, save: async () => undefined })
      .hasUnsavedChanges()).toBeFalse();
  });

  it('says NOTHING TO LOSE when the footer editor is not rendered', () => {
    // On the Docking Bar tab the footer editor does not exist. "Nothing to
    // ask about" has to read as "nothing to lose" - the alternative is a
    // guard that throws, which is what cancelled the navigation.
    expect(make(undefined).hasUnsavedChanges()).toBeFalse();
  });

  it('never throws, whichever tab is showing', () => {
    // The property the guard actually depends on. It is the throwing, not
    // the answer, that made clicking do nothing.
    expect(() => make(undefined).hasUnsavedChanges()).not.toThrow();
    expect(() => make({ hasUnsavedChanges: () => true, save: async () => undefined })
      .hasUnsavedChanges()).not.toThrow();
  });

  it('passes a save through to the footer editor', async () => {
    let saved = false;
    await make({ hasUnsavedChanges: () => true, save: async () => { saved = true; } }).save();
    expect(saved).toBeTrue();
  });

  it('saves harmlessly when there is no footer editor to save', async () => {
    await expectAsync(make(undefined).save()).toBeResolved();
  });
});
