import { LIBRARY_EXTRA_LANGUAGE_CODES, LIBRARY_ISO_639_1_CODES } from './library-iso-language-codes';

export interface LibraryLanguageOption {
  code: string;
  label: string;
}

let cached: LibraryLanguageOption[] | null = null;

// Ported verbatim from impact-discipleship-library-manager-new's
// core/services/language-options.util.ts.
export function getLibraryLanguageOptions(): LibraryLanguageOption[] {
  if (cached) {
    return cached;
  }
  const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
  cached = [
    ...LIBRARY_ISO_639_1_CODES.map((code) => ({ code, label: displayNames.of(code) ?? code })),
    ...LIBRARY_EXTRA_LANGUAGE_CODES.map(({ code, label }) => ({ code, label })),
  ].sort((a, b) => a.label.localeCompare(b.label));
  return cached;
}
