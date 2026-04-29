/**
 * Parse markdown front-matter from a raw file string.
 *
 * Supports YAML (`---` delimited) and TOML (`+++` delimited) front-matter at
 * the start of the file. Hand-rolled — covers scalars (string, number,
 * boolean), simple sequences (`- item` lines), and `key: value` / `key = value`
 * pairs. Malformed front-matter is swallowed (returns empty object + best-effort
 * body) rather than thrown — caller decides whether to flag.
 */

export interface ParsedMarkdownFrontMatter {
  frontMatter: Record<string, unknown>;
  body: string;
}

const BOM = '﻿';

export function parseMarkdownFrontMatter(
  input: string,
): ParsedMarkdownFrontMatter {
  const stripped = input.startsWith(BOM) ? input.slice(BOM.length) : input;

  const yamlMatch = matchDelimited(stripped, '---');
  if (yamlMatch) {
    const parsed = safeParseYaml(yamlMatch.frontMatterRaw);
    return { frontMatter: parsed, body: yamlMatch.body };
  }

  const tomlMatch = matchDelimited(stripped, '+++');
  if (tomlMatch) {
    const parsed = safeParseToml(tomlMatch.frontMatterRaw);
    return { frontMatter: parsed, body: tomlMatch.body };
  }

  return { frontMatter: {}, body: input };
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

function safeParseYaml(raw: string): Record<string, unknown> {
  try {
    return parseYamlSimple(raw);
  } catch {
    return {};
  }
}

function safeParseToml(raw: string): Record<string, unknown> {
  try {
    return parseTomlSimple(raw);
  } catch {
    return {};
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
