import { LibraryFormioSchema } from 'src/app/common/models/domain/library/library-lesson.model';

// Ported verbatim from impact-discipleship-library-manager-new's
// core/services/template-merge.util.ts.

/** Concatenates a subtemplate's components into a schema's components, at the
 *  top or bottom, without mutating either input. */
export function mergeSubtemplateIntoSchema(
  baseSchema: LibraryFormioSchema,
  subtemplateSchema: LibraryFormioSchema | null | undefined,
  placement: 'top' | 'bottom'
): LibraryFormioSchema {
  const subtemplateComponents = subtemplateSchema?.components ?? [];
  const components =
    placement === 'top'
      ? [...subtemplateComponents, ...baseSchema.components]
      : [...baseSchema.components, ...subtemplateComponents];
  return { ...baseSchema, components };
}

/** Flattens a Lesson Template's header/layout/footer subtemplates (whichever
 *  are set), in that order, into a single schema - used when applying one at
 *  lesson creation (a later slice; kept here alongside its sibling above so
 *  both port together). */
export function flattenLessonTemplateComponents(
  headerSchema: LibraryFormioSchema | null | undefined,
  layoutSchema: LibraryFormioSchema | null | undefined,
  footerSchema: LibraryFormioSchema | null | undefined
): LibraryFormioSchema {
  let schema: LibraryFormioSchema = { display: 'form', components: [] };
  schema = mergeSubtemplateIntoSchema(schema, headerSchema, 'bottom');
  schema = mergeSubtemplateIntoSchema(schema, layoutSchema, 'bottom');
  schema = mergeSubtemplateIntoSchema(schema, footerSchema, 'bottom');
  return schema;
}
