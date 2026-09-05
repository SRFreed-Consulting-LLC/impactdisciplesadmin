import { PageContentBlock } from '@impact-common/shared/models/domain/page-content.model';
import { KindVariant, PageSectionKind } from './page-section-catalogue';

/**
 * THE THREE DERIVATIONS BOTH HALVES OF THE SECTION EDITOR NEED.
 *
 * The editor split into a shell and an appearance panel on 2026-09-05, and
 * these are what did not split cleanly: the shell needs them for the tab
 * strip's summary and for the picture field, the panel needs them for the
 * controls themselves.
 *
 * Pure functions rather than a shared base class or an injected service,
 * because that is all they are - three expressions over a block and its kind,
 * with no state and nothing to inject. Two copies of a one-line derivation
 * would drift into the editor and the panel disagreeing about which look is
 * selected, which shows up as a control that highlights the wrong option and
 * nothing else.
 */

/**
 * The chosen look, or the first.
 *
 * A section written before variants existed, or one whose variant was
 * retired, still shows real fields rather than none - which is why this falls
 * back rather than returning undefined for an unknown key.
 * @param kind The section kind, with its variants.
 * @param section The block being edited.
 * @returns The active variant, or undefined if the kind declares none.
 */
export function activeVariantOf(
  kind: PageSectionKind | undefined,
  section: PageContentBlock | undefined
): KindVariant | undefined {
  const variants = kind?.variants;
  if (!variants?.length) {
    return undefined;
  }
  return variants.find((v) => v.key === section?.variant) ?? variants[0];
}

/**
 * What ground this section is drawn on.
 *
 * 'inherit' rather than undefined, so a control always has a selection and
 * "same as the page" reads as a choice rather than a blank.
 * @param section The block being edited.
 * @returns The stored surface, or 'inherit'.
 */
export function activeSurfaceOf(section: PageContentBlock | undefined): string {
  return section?.surface ?? 'inherit';
}

/**
 * Is this section's picture a cropped BACKGROUND rather than content?
 *
 * Used on both sides of the tab boundary and that is why it lives here: the
 * appearance panel offers the focal-point drag only while it is true, and the
 * content side shows a picture field at all when it is true even for a kind
 * that declares no image field - a photo surface needs a photo from
 * somewhere.
 * @param section The block being edited.
 * @returns Whether the surface is 'photo'.
 */
export function isOnPhotoSurface(section: PageContentBlock | undefined): boolean {
  return activeSurfaceOf(section) === 'photo';
}
