/**
 * Parse markdown front-matter from a raw file string.
 *
 * Supports YAML (`---` delimited) and TOML (`+++` delimited) front-matter at
 * the start of the file. Hand-rolled — covers scalars (string, number,
 * boolean), simple sequences (`- item` lines), and `key: value` / `key = value`
 * pairs.
 *
 * Return contract:
 *   - No front-matter block: `{ frontMatter: null, body: input }`
 *   - Well-formed FM:        `{ frontMatter: {...}, body: <after-closing-delim> }`
 *   - Malformed YAML/TOML:   `{ frontMatter: null, body: <best-effort>, error: <msg> }`
 *
 * Malformed front-matter is captured (not thrown) so callers can decide whether
 * to surface a warning to the user.
 */

/** @public */
export interface ParsedMarkdownFrontMatter {
  frontMatter: Record<string, unknown> | null;
  body: string;
  error?: string;
}

const BOM = '﻿';

export function parseMarkdownFrontMatter(
  input: string,
): ParsedMarkdownFrontMatter {
  const stripped = input.startsWith(BOM) ? input.slice(BOM.length) : input;

  const yamlMatch = matchDelimited(stripped, '---');
  if (yamlMatch) {
    const parsed = safeParseYaml(yamlMatch.frontMatterRaw);
    if (parsed.error !== undefined) {
      return {
        frontMatter: null,
        body: yamlMatch.body,
        error: parsed.error,
      };
    }
    return { frontMatter: parsed.value, body: yamlMatch.body };
  }

  const tomlMatch = matchDelimited(stripped, '+++');
  if (tomlMatch) {
    const parsed = safeParseToml(tomlMatch.frontMatterRaw);
    if (parsed.error !== undefined) {
      return {
        frontMatter: null,
        body: tomlMatch.body,
        error: parsed.error,
      };
    }
    return { frontMatter: parsed.value, body: tomlMatch.body };
  }

  return { frontMatter: null, body: input };
}

interface DelimitedMatch {
  frontMatterRaw: string;
  body: string;
}

function matchDelimited(
  input: string,
  delimiter: string,
): DelimitedMatch | null {
  const lines = input.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== delimiter) {
    return null;
  }

  // Find closing delimiter, starting from line 1.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === delimiter) {
      const frontMatterRaw = lines.slice(1, i).join('\n');
      const body = lines
        .slice(i + 1)
        .join('\n')
        .replace(/^\n+/, '');
      return { frontMatterRaw, body };
    }
  }

  return null;
}

interface ParseResult {
  value: Record<string, unknown>;
  error?: string;
}

function safeParseYaml(raw: string): ParseResult {
  try {
    return { value: parseYamlSimple(raw) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'malformed yaml';
    return { value: {}, error: message };
  }
}

function safeParseToml(raw: string): ParseResult {
  try {
    return { value: parseTomlSimple(raw) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'malformed toml';
    return { value: {}, error: message };
  }
}

const YAML_KEY_RE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;
const YAML_LIST_ITEM_RE = /^\s*-\s+(.*)$/;

function parseYamlSimple(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  let currentListKey: string | null = null;
  let currentList: unknown[] = [];

  const flushList = () => {
    if (currentListKey !== null) {
      result[currentListKey] = currentList;
      currentListKey = null;
      currentList = [];
    }
  };

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;

    const listMatch = rawLine.match(YAML_LIST_ITEM_RE);
    if (listMatch && currentListKey !== null) {
      currentList.push(coerceYamlScalar(listMatch[1].trim()));
      continue;
    }

    const keyMatch = rawLine.match(YAML_KEY_RE);
    if (!keyMatch) {
      // Unknown line shape — bail to malformed.
      throw new Error('malformed yaml');
    }

    flushList();

    const key = keyMatch[1];
    const value = keyMatch[2];

    if (value === '') {
      // Block-style sequence start: next lines may be `- item`.
      currentListKey = key;
      currentList = [];
      continue;
    }

    result[key] = coerceYamlScalar(value);
  }

  flushList();

  return result;
}

function coerceYamlScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';

  // Quoted strings — strip surrounding quotes.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;

  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d*\.\d+$/.test(trimmed)) return Number(trimmed);

  return trimmed;
}

const TOML_KEY_RE = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/;

function parseTomlSimple(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;

    const keyMatch = rawLine.match(TOML_KEY_RE);
    if (!keyMatch) {
      throw new Error('malformed toml');
    }

    const key = keyMatch[1];
    const value = keyMatch[2].trim();
    result[key] = coerceTomlScalar(value);
  }

  return result;
}

function coerceTomlScalar(raw: string): unknown {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d*\.\d+$/.test(raw)) return Number(raw);
  return raw;
}
