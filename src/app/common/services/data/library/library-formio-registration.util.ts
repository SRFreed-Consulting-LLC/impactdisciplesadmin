import { registerColorFieldComponent } from '@impact-common/formio/color-field.component';
import { registerColoredContainerComponent } from '@impact-common/formio/colored-container.component';
import { registerLibraryFieldComponent } from '@impact-common/formio/library-field.component';

/**
 * Registers the shared custom Form.io components (library/color/colored-
 * container fields) the first time a Library Form.io-editing/-rendering
 * screen actually loads, instead of eagerly at app bootstrap - same reason
 * the source app does this (`@formio/js` is a multi-MB CommonJS dependency,
 * see angular.json's allowedCommonJsDependencies). Each register*Component()
 * call is itself idempotent - safe for every consumer to call this in its
 * own constructor.
 */
export function ensureLibraryFormioComponentsRegistered(): void {
  registerLibraryFieldComponent();
  // Must run before registerColoredContainerComponent() actually gets used
  // (its edit form references type: 'colorField') - registration order here
  // matters even though both happen well before any dialog opens.
  registerColorFieldComponent();
  registerColoredContainerComponent();
}
