import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  collectFileStats,
  collectCodeStats,
  countFiles,
  countTopLevelDirs,
  generateMarkdown,
  checkStats,
  type RuntimeStats,
  type DbStats,
} from "../../scripts/generate-codebase-stats";

const ROOT = path.resolve(__dirname, "../..");
const JSON_OUTPUT = path.join(ROOT, "docs", "generated", "codebase-stats.json");

// ---------------------------------------------------------------------------
// File-countable stats
// ---------------------------------------------------------------------------

describe("collectFileStats", () => {
  let stats: Record<string, number>;

  beforeAll(() => {
    stats = collectFileStats();
  });

  it("returns an object with all expected keys", () => {
    const expectedKeys = [
      "vitest_test_files",
      "e2e_spec_files",
      "python_test_files",
      "migrations",
      "api_route_files",
      "api_route_groups",
      "page_routes",
      "components_total",
      "components_custom",
      "components_shadcn",
      "hooks",
      "contexts",
      "lib_modules_toplevel",
      "lib_modules_total",
      "type_files",
      "ai_modules",
      "ai_skill_files",
      "validation_files",
      "extraction_files",
      "pipeline_modules",
      "mcp_tool_category_files",
      "mcp_apps",
      "quality_checks",
      "cron_routes",
    ];

    for (const key of expectedKeys) {
      expect(stats).toHaveProperty(key);
    }
  });

  it("returns positive integers for all file counts", () => {
    for (const [key, value] of Object.entries(stats)) {
      expect(Number.isInteger(value), `${key} should be an integer`).toBe(true);
      expect(value, `${key} should be >= 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it("counts vitest test files correctly (should be substantial)", () => {
    expect(stats.vitest_test_files).toBeGreaterThan(100);
  });

  it("counts migrations correctly (at least 1 after squash)", () => {
    expect(stats.migrations).toBeGreaterThanOrEqual(1);
  });

  it("counts API route files correctly", () => {
    expect(stats.api_route_files).toBeGreaterThan(50);
  });

  it("components_custom + components_shadcn = components_total", () => {
    expect(stats.components_custom + stats.components_shadcn).toBe(
      stats.components_total
    );
  });

  it("lib_modules_total >= lib_modules_toplevel", () => {
    expect(stats.lib_modules_total).toBeGreaterThanOrEqual(
      stats.lib_modules_toplevel
    );
  });

  it("counts page routes (should be at least 10)", () => {
    expect(stats.page_routes).toBeGreaterThanOrEqual(10);
  });

  it("counts hooks (should be at least 20)", () => {
    expect(stats.hooks).toBeGreaterThanOrEqual(20);
  });

  it("counts e2e spec files (should be at least 5)", () => {
    expect(stats.e2e_spec_files).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe("countFiles", () => {
  it("returns 0 for a pattern that matches nothing", () => {
    expect(countFiles("nonexistent-dir/**/*.xyz")).toBe(0);
  });

  it("returns a positive number for a known pattern", () => {
    expect(countFiles("package.json")).toBe(1);
  });
});

describe("countTopLevelDirs", () => {
  it("returns 0 for a non-existent directory", () => {
    expect(countTopLevelDirs("this-dir-does-not-exist")).toBe(0);
  });

  it("returns a positive number for app/api", () => {
    expect(countTopLevelDirs("app/api")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Code-parsable stats
// ---------------------------------------------------------------------------

describe("collectCodeStats", () => {
  let stats: Record<string, number>;

  beforeAll(() => {
    stats = collectCodeStats();
  });

  it("returns all expected keys", () => {
    const expectedKeys = [
      "mcp_tools",
      "mcp_resources",
      "mcp_prompts",
      "content_types",
    ];

    for (const key of expectedKeys) {
      expect(stats).toHaveProperty(key);
    }
  });

  it("returns positive integers for all code stats", () => {
    for (const [key, value] of Object.entries(stats)) {
      expect(Number.isInteger(value), `${key} should be an integer`).toBe(true);
      expect(value, `${key} should be > 0`).toBeGreaterThan(0);
    }
  });

  it("counts MCP tools correctly (should be at least 30)", () => {
    expect(stats.mcp_tools).toBeGreaterThanOrEqual(30);
  });

  it("counts MCP resources correctly (should be at least 8)", () => {
    expect(stats.mcp_resources).toBeGreaterThanOrEqual(8);
  });

  it("counts MCP prompts correctly (should be at least 3)", () => {
    expect(stats.mcp_prompts).toBeGreaterThanOrEqual(3);
  });

  it("counts content types correctly (should be at least 10)", () => {
    expect(stats.content_types).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// JSON output format
// ---------------------------------------------------------------------------

describe("JSON output format", () => {
  it("generated JSON file exists and parses correctly", () => {
    // This test assumes the script has been run at least once
    if (!fs.existsSync(JSON_OUTPUT)) {
      // Skip if file doesn't exist (e.g. fresh clone)
      return;
    }

    const content = fs.readFileSync(JSON_OUTPUT, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed).toHaveProperty("generated_at");
    expect(parsed).toHaveProperty("generator");
    expect(parsed).toHaveProperty("stats");
    expect(parsed).toHaveProperty("runtime_stats");
    expect(parsed).toHaveProperty("db_stats");

    expect(parsed.generator).toBe("scripts/generate-codebase-stats.ts");
    expect(typeof parsed.generated_at).toBe("string");
  });

  it("JSON stats section has all expected keys", () => {
    if (!fs.existsSync(JSON_OUTPUT)) return;

    const parsed = JSON.parse(fs.readFileSync(JSON_OUTPUT, "utf-8"));
    const statKeys = Object.keys(parsed.stats);

    const expectedFileKeys = [
      "vitest_test_files",
      "e2e_spec_files",
      "python_test_files",
      "migrations",
      "api_route_files",
      "api_route_groups",
      "page_routes",
      "components_total",
      "components_custom",
      "components_shadcn",
      "hooks",
      "contexts",
      "lib_modules_toplevel",
      "lib_modules_total",
      "type_files",
      "ai_modules",
      "ai_skill_files",
      "validation_files",
      "extraction_files",
      "pipeline_modules",
      "mcp_tool_category_files",
      "mcp_apps",
      "quality_checks",
      "cron_routes",
    ];

    for (const key of expectedFileKeys) {
      expect(statKeys, `Missing stat key: ${key}`).toContain(key);
    }
  });

  it("JSON runtime_stats has null values when --full not used", () => {
    if (!fs.existsSync(JSON_OUTPUT)) return;

    const parsed = JSON.parse(fs.readFileSync(JSON_OUTPUT, "utf-8"));

    expect(parsed.runtime_stats).toEqual({
      vitest_test_count: null,
      python_test_count: null,
      lint_errors: null,
      lint_warnings: null,
    });
  });

  it("JSON db_stats has null values when --db not used", () => {
    if (!fs.existsSync(JSON_OUTPUT)) return;

    const parsed = JSON.parse(fs.readFileSync(JSON_OUTPUT, "utf-8"));

    expect(parsed.db_stats).toEqual({
      tables: null,
      rls_policies: null,
      rpc_functions: null,
      domains_count: null,
      subtopics_count: null,
      content_items_count: null,
      entity_count: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

describe("generateMarkdown", () => {
  it("produces valid Markdown with all sections", () => {
    const fileStats = collectFileStats();
    const codeStats = collectCodeStats();
    const runtimeStats: RuntimeStats = {
      vitest_test_count: null,
      python_test_count: null,
      lint_errors: null,
      lint_warnings: null,
    };
    const dbStats: DbStats = {
      tables: null,
      rls_policies: null,
      rpc_functions: null,
      domains_count: null,
      subtopics_count: null,
      content_items_count: null,
      entity_count: null,
    };

    const md = generateMarkdown(
      fileStats,
      codeStats,
      runtimeStats,
      dbStats,
      "2026-03-23T14:30:00.000Z"
    );

    expect(md).toContain("<!-- AUTO-GENERATED");
    expect(md).toContain("# Codebase Statistics");
    expect(md).toContain("## Frontend");
    expect(md).toContain("## Backend");
    expect(md).toContain("## Testing");
    expect(md).toContain("## MCP");
    expect(md).toContain("## Library");
    expect(md).toContain("## Pipeline");
    expect(md).toContain("## Quality & Checks");
    expect(md).toContain("## Database");
  });

  it("formats date in UK English (DD/MM/YYYY HH:mm)", () => {
    const md = generateMarkdown(
      collectFileStats(),
      collectCodeStats(),
      {
        vitest_test_count: null,
        python_test_count: null,
        lint_errors: null,
        lint_warnings: null,
      },
      {
        tables: null,
        rls_policies: null,
        rpc_functions: null,
        domains_count: null,
        subtopics_count: null,
        content_items_count: null,
        entity_count: null,
      },
      "2026-03-23T14:30:00.000Z"
    );

    // The date should be formatted in UK style
    // Note: the exact output depends on the local timezone, but the format
    // should be DD/MM/YYYY HH:mm
    expect(md).toMatch(/Generated: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  it("shows em-dash for null runtime values", () => {
    const md = generateMarkdown(
      collectFileStats(),
      collectCodeStats(),
      {
        vitest_test_count: null,
        python_test_count: null,
        lint_errors: null,
        lint_warnings: null,
      },
      {
        tables: null,
        rls_policies: null,
        rpc_functions: null,
        domains_count: null,
        subtopics_count: null,
        content_items_count: null,
        entity_count: null,
      },
      "2026-03-23T14:30:00.000Z"
    );

    // Null values should show as em-dash
    expect(md).toContain("| Vitest test count | \u2014 |");
  });

  it("shows actual numbers for populated runtime values", () => {
    const md = generateMarkdown(
      collectFileStats(),
      collectCodeStats(),
      {
        vitest_test_count: 5131,
        python_test_count: 555,
        lint_errors: 0,
        lint_warnings: 12,
      },
      {
        tables: null,
        rls_policies: null,
        rpc_functions: null,
        domains_count: null,
        subtopics_count: null,
        content_items_count: null,
        entity_count: null,
      },
      "2026-03-23T14:30:00.000Z"
    );

    expect(md).toContain("5,131");
    expect(md).toContain("555");
    expect(md).toContain("| Lint errors | 0 |");
    expect(md).toContain("| Lint warnings | 12 |");
  });
});

// ---------------------------------------------------------------------------
// Check mode
// ---------------------------------------------------------------------------

describe("checkStats", () => {
  it("returns true when stats match", () => {
    if (!fs.existsSync(JSON_OUTPUT)) return;

    const existing = JSON.parse(fs.readFileSync(JSON_OUTPUT, "utf-8"));

    // checkStats compares stats, runtime_stats, and db_stats
    const result = checkStats(existing);
    expect(result).toBe(true);
  });

  it("returns false when stats differ", () => {
    if (!fs.existsSync(JSON_OUTPUT)) return;

    const existing = JSON.parse(fs.readFileSync(JSON_OUTPUT, "utf-8"));
    // Modify one value
    const modified = {
      ...existing,
      stats: { ...existing.stats, vitest_test_files: -1 },
    };

    // Suppress console.error output during test
    const origError = console.error;
    console.error = () => {};
    const result = checkStats(modified);
    console.error = origError;

    expect(result).toBe(false);
  });

  it("returns true even if generated_at differs", () => {
    if (!fs.existsSync(JSON_OUTPUT)) return;

    const existing = JSON.parse(fs.readFileSync(JSON_OUTPUT, "utf-8"));
    const modified = {
      ...existing,
      generated_at: "2099-01-01T00:00:00.000Z",
    };

    const result = checkStats(modified);
    expect(result).toBe(true);
  });
});
