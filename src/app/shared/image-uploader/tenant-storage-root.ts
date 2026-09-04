import { TENANT_ID } from '@impact-common/shared/lists/tenancy';

/**
 * WHERE THIS TENANT'S FILES LIVE IN STORAGE.
 *
 * The Storage half of the tenancy seam (see the shared tenancy.ts for the
 * Firestore half). `scripts/move-site-storage.js` gathered the site's images
 * under this prefix on 2026-09-02; this is the constant that makes the ADMIN
 * put new ones there too, rather than leaving it to whoever is uploading to
 * navigate to the right folder first.
 *
 * DERIVED FROM TENANT_ID rather than typed out, so the tenant has exactly
 * one spelling in this codebase. It is not in the shared submodule only
 * because nothing outside the admin needs it yet - the web and reader read
 * URLs that are already stored, they never construct a Storage path. Move it
 * there the moment that stops being true.
 *
 * NO TRAILING SLASH: it is joined like any other folder path.
 */
export const TENANT_STORAGE_ROOT = `tenants/${TENANT_ID}`;
