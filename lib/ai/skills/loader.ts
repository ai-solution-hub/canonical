import { readFile } from 'fs/promises';
import { join } from 'path';

const skillCache = new Map<string, string>();

/**
 * Load a skill file by name. Skill files are markdown documents in
 * `lib/ai/skills/` that provide domain knowledge context for AI prompts.
 *
 * Results are cached in memory after first load.
 */
export async function loadSkill(name: string): Promise<string> {
  if (skillCache.has(name)) return skillCache.get(name)!;
  const path = join(__dirname, `${name}.md`);
  const content = await readFile(path, 'utf-8');
  skillCache.set(name, content);
  return content;
}

/**
 * Clear the skill cache. Useful for testing or when skill files are updated.
 */
export function clearSkillCache(): void {
  skillCache.clear();
}
