import { SKILLS } from '@/lib/ai/skills/inlined.generated';

/**
 * Load a skill markdown file by name. Skills are inlined at build time
 * via scripts/generate-skills-inline.ts; this module performs no
 * filesystem reads at runtime (the previous fs/promises + __dirname
 * implementation hit ENOENT on Vercel because the loader chunk is
 * relocated away from the static lib/ai/skills/*.md files during
 * deployment bundling).
 *
 * Async signature preserved for backwards compatibility with existing
 * callers (lib/ai/classify.ts, lib/ai/draft.ts, lib/mcp/resources.ts).
 */
export async function loadSkill(name: string): Promise<string> {
  const content = SKILLS[name];
  if (content === undefined) {
    throw new Error(
      `Unknown skill "${name}". Known skills: ${Object.keys(SKILLS).join(', ')}.`,
    );
  }
  return content;
}
