/**
 * First downstream consumer of the markdown ontology register.
 *
 * Replaces the hand-authored `VALID_CONTENT_TYPES` constant that used to live
 * at `lib/validation/schemas.ts:41-57`. The values now derive from
 * `docs/ontology/04-content-type.md` `baseline_values[].key`. A parity test
 * (`__tests__/lib/ontology/markdown-parity.test.ts`) asserts the markdown
 * register and the live DB CHECK constraint remain in lockstep.
 *
 * Spec: `docs/specs/wp6-ontology-harness/TECH.md` §5.3.
 */
import { loadOntologyCVs } from '@/lib/ontology/loader';

const cvs = loadOntologyCVs();
const contentTypeCV = cvs.find((cv) => cv.cv_name === 'content_type');

if (!contentTypeCV) {
  throw new Error(
    '[ontology/content-type-registry] No `content_type` CV found in the ' +
      'markdown ontology register. Ensure `docs/ontology/04-content-type.md` ' +
      'exists with `cv_name: content_type` in its frontmatter.',
  );
}

/**
 * Closed enumeration of valid `content_items.content_type` values, derived
 * from the markdown ontology. Bidirectionally set-equal to the live DB
 * CHECK constraint via the parity test.
 */
export const CONTENT_TYPE_VALUES: readonly string[] = Object.freeze(
  contentTypeCV.baseline_values.map((bv) => bv.key),
);
