#!/usr/bin/env bun
/**
 * Compare two content-state snapshots and produce a quality report
 * (Plan D Task D4 Step 4).
 *
 * Reads two JSONL files written by scripts/snapshot-content-state.ts and
 * computes the seven quality dimensions defined in spec SS6.1:
 *
 *   1. Structural fidelity      — heading count preservation (proxy: word count)
 *   2. Content completeness     — character count ratio (0.95..1.10)
 *   3. Embedding stability      — cosine similarity (median > 0.95, none < 0.90)
 *   4. Classification stability — primary_domain match (>= 95%)
 *   5. Entity extraction        — Jaccard similarity of entity counts by bucket
 *   6. Coverage equivalence     — domain distribution (no domain loses > 10%)
 *   7. Chunk quality            — chunks-per-document ranges by content_type
 *
 * Output is a markdown report suitable for pasting into a session handoff.
 *
 * The script runs entirely offline — no Supabase or OpenAI access. Chunk
 * counts are read from the snapshot's `chunk_count` field (populated by
 * snapshot-content-state.ts).
 *
 * Usage:
 *   bun run scripts/compare-quality.ts \
 *     --old data/snapshots/pre-reingest-2026-04-14.jsonl \
 *     --new data/snapshots/post-reingest-2026-04-14.jsonl \
 *     --output data/reports/re-ingest-report-2026-04-14.md
 */

import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

// ── Args ───────────────────────────────────────────────────────────────────

export type PairKeyStrategy = 'id' | 'title+content_type';

interface RuntimeConfig {
  oldPath: string;
  newPath: string;
  outputPath: string;
  pairKey: PairKeyStrategy;
}

function parseRuntimeArgs(): RuntimeConfig {
  const { values } = parseArgs({
    options: {
      old: { type: 'string', default: '' },
      new: { type: 'string', default: '' },
      output: { type: 'string', default: '' },
      'pair-key': { type: 'string', default: 'id' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Usage: bun run scripts/compare-quality.ts --old <path> --new <path> [--output <path>] [--pair-key <strategy>]

Options:
  --old PATH                    Older snapshot JSONL (pre re-ingestion)
  --new PATH                    Newer snapshot JSONL (post re-ingestion)
  --output PATH                 Write markdown report to this path (default stdout)
  --pair-key STRATEGY           Pairing strategy: id (default, in-place re-ingest)
                                or title+content_type (cross-project re-ingest)
  --help                        Show this help
`);
    process.exit(0);
  }

  const oldPath = values.old!.trim();
  const newPath = values.new!.trim();
  const pairKeyRaw = (values['pair-key'] as string | undefined)?.trim() ?? 'id';

  if (pairKeyRaw !== 'id' && pairKeyRaw !== 'title+content_type') {
    console.error(
      `Invalid --pair-key '${pairKeyRaw}'. Must be 'id' or 'title+content_type'.`,
    );
    process.exit(1);
  }

  if (!oldPath || !newPath) {
    console.error('Both --old and --new are required. See --help.');
    process.exit(1);
  }
  return {
    oldPath,
    newPath,
    outputPath: values.output!.trim(),
    pairKey: pairKeyRaw as PairKeyStrategy,
  };
}

export function snapshotPairKey(
  s: Pick<ContentSnapshot, 'id' | 'title' | 'content_type'>,
  strategy: PairKeyStrategy,
): string {
  if (strategy === 'id') return s.id;
  const title = s.title.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${title}|${s.content_type}`;
}

// ── Snapshot shape ─────────────────────────────────────────────────────────

interface ContentSnapshot {
  id: string;
  title: string;
  content_type: string;
  source_url: string | null;
  content_length: number;
  primary_domain: string | null;
  primary_subtopic: string | null;
  classification_confidence: number | null;
  ai_keywords: string[] | null;
  user_tags: string[] | null;
  embedding: number[] | null;
  canonical_names: string[];
  summary_length: number | null;
  word_count: number;
  heading_count: number;
  chunk_count: number;
  created_at: string;
  freshness: string | null;
}

export interface SnapshotReadResult {
  map: Map<string, ContentSnapshot>;
  collisions: number;
  total: number;
}

export function readSnapshot(
  p: string,
  pairKey: PairKeyStrategy = 'id',
): SnapshotReadResult {
  if (!fs.existsSync(p)) {
    console.error(
      `Could not read snapshot at ${p}. Check the path and that the snapshot script completed successfully.`,
    );
    process.exit(1);
  }
  const content = fs.readFileSync(p, 'utf-8');
  const map = new Map<string, ContentSnapshot>();
  let collisions = 0;
  let total = 0;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line) as ContentSnapshot;
    total++;
    const key = snapshotPairKey(obj, pairKey);
    if (map.has(key)) {
      collisions++;
      continue;
    }
    map.set(key, obj);
  }
  return { map, collisions, total };
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function jaccardSimilarity<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const union = a.size + b.size - inter;
  if (union === 0) return 1;
  return inter / union;
}

export interface DomainDelta {
  domain: string;
  oldCount: number;
  newCount: number;
  deltaPct: number;
}

export function domainDistribution(
  snapshots: Iterable<ContentSnapshot>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of snapshots) {
    const d = s.primary_domain ?? '(unclassified)';
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

export function domainDeltas(
  oldDist: Map<string, number>,
  newDist: Map<string, number>,
): DomainDelta[] {
  const domains = new Set<string>([...oldDist.keys(), ...newDist.keys()]);
  const deltas: DomainDelta[] = [];
  for (const domain of domains) {
    const oldCount = oldDist.get(domain) ?? 0;
    const newCount = newDist.get(domain) ?? 0;
    const deltaPct =
      oldCount === 0 ? (newCount === 0 ? 0 : Infinity) : (newCount - oldCount) / oldCount;
    deltas.push({ domain, oldCount, newCount, deltaPct });
  }
  return deltas.sort((a, b) => b.oldCount - a.oldCount);
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── Dimension computations ─────────────────────────────────────────────────

export interface PairStat {
  id: string;
  oldId: string;
  newId: string;
  pairKey: string;
  content_type: string;
  contentRatio: number | null;
  wordCountRatio: number | null;
  headingRatio: number | null;
  similarity: number | null;
  domainMatch: boolean | null;
  entityJaccard: number | null;
  aiKeywordJaccard: number | null;
  userTagJaccard: number | null;
  chunkCountNew: number;
  chunkCountOld: number;
}

export function computePairStats(
  oldMap: Map<string, ContentSnapshot>,
  newMap: Map<string, ContentSnapshot>,
): PairStat[] {
  const out: PairStat[] = [];
  for (const [key, oldItem] of oldMap) {
    const newItem = newMap.get(key);
    if (!newItem) continue;

    const contentRatio =
      oldItem.content_length > 0
        ? newItem.content_length / oldItem.content_length
        : null;
    const wordCountRatio =
      oldItem.word_count > 0 ? newItem.word_count / oldItem.word_count : null;
    const headingRatio =
      oldItem.heading_count > 0
        ? newItem.heading_count / oldItem.heading_count
        : null;

    let similarity: number | null = null;
    if (
      oldItem.embedding &&
      newItem.embedding &&
      oldItem.embedding.length === newItem.embedding.length &&
      oldItem.embedding.length > 0
    ) {
      similarity = cosineSimilarity(oldItem.embedding, newItem.embedding);
    }

    const domainMatch =
      oldItem.primary_domain !== null
        ? oldItem.primary_domain === newItem.primary_domain
        : null;

    let entityJaccard: number | null = null;
    const oldNames = new Set(oldItem.canonical_names);
    const newNames = new Set(newItem.canonical_names);
    if (oldNames.size > 0 || newNames.size > 0) {
      entityJaccard = jaccardSimilarity(oldNames, newNames);
    }

    let aiKeywordJaccard: number | null = null;
    const oldAiKw = new Set(oldItem.ai_keywords ?? []);
    const newAiKw = new Set(newItem.ai_keywords ?? []);
    if (oldAiKw.size > 0 || newAiKw.size > 0) {
      aiKeywordJaccard = jaccardSimilarity(oldAiKw, newAiKw);
    }

    let userTagJaccard: number | null = null;
    const oldUserTags = new Set(oldItem.user_tags ?? []);
    const newUserTags = new Set(newItem.user_tags ?? []);
    if (oldUserTags.size > 0 || newUserTags.size > 0) {
      userTagJaccard = jaccardSimilarity(oldUserTags, newUserTags);
    }

    out.push({
      id: oldItem.id,
      oldId: oldItem.id,
      newId: newItem.id,
      pairKey: key,
      content_type: oldItem.content_type,
      contentRatio,
      wordCountRatio,
      headingRatio,
      similarity,
      domainMatch,
      entityJaccard,
      aiKeywordJaccard,
      userTagJaccard,
      chunkCountNew: newItem.chunk_count,
      chunkCountOld: oldItem.chunk_count,
    });
  }
  return out;
}

// ── Report rendering ───────────────────────────────────────────────────────

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits);
}

interface Dim {
  name: string;
  metric: string;
  threshold: string;
  value: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'N/A';
}

function renderReport(
  oldMap: Map<string, ContentSnapshot>,
  newMap: Map<string, ContentSnapshot>,
  pairs: PairStat[],
  config: RuntimeConfig,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Re-ingestion Quality Report`);
  lines.push('');
  lines.push(`Date: ${today}`);
  lines.push(`Old snapshot: \`${config.oldPath}\``);
  lines.push(`New snapshot: \`${config.newPath}\``);
  lines.push(`Pair key: \`${config.pairKey}\``);
  lines.push(`Old items: ${oldMap.size}  |  New items: ${newMap.size}  |  Paired: ${pairs.length}`);
  lines.push('');

  // Dim 1: Structural fidelity (heading-count ratio)
  const headingRatios = pairs
    .map((p) => p.headingRatio)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const headingsPreserved = headingRatios.filter((r) => r >= 0.9).length;
  const headingsPreservedPct = headingRatios.length
    ? headingsPreserved / headingRatios.length
    : NaN;

  // Dim 8 (supplementary): Body-text completeness (word-count ratio)
  const wcRatios = pairs
    .map((p) => p.wordCountRatio)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const wcPreserved = wcRatios.filter((r) => r >= 0.9).length;
  const wcPreservedPct = wcRatios.length ? wcPreserved / wcRatios.length : NaN;

  // Dim 2: Content completeness (char-count ratio)
  const contentRatios = pairs
    .map((p) => p.contentRatio)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const contentInBand = contentRatios.filter((r) => r >= 0.95 && r <= 1.1).length;
  const contentInBandPct = contentRatios.length ? contentInBand / contentRatios.length : NaN;
  const medianContentRatio = median(contentRatios);

  // Dim 3: Embedding stability
  const sims = pairs
    .map((p) => p.similarity)
    .filter((v): v is number => v !== null);
  const medianSim = median(sims);
  const minSim = sims.length ? Math.min(...sims) : NaN;

  // Dim 4: Classification stability (primary domain match)
  const domainChecked = pairs.filter((p) => p.domainMatch !== null);
  const domainMatches = domainChecked.filter((p) => p.domainMatch).length;
  const domainMatchPct = domainChecked.length
    ? domainMatches / domainChecked.length
    : NaN;

  // Dim 5: Entity extraction stability
  const jaccards = pairs
    .map((p) => p.entityJaccard)
    .filter((v): v is number => v !== null);
  const meanJaccard = mean(jaccards);

  // Dim 9a: AI keyword (tag) stability
  const aiKwJaccards = pairs
    .map((p) => p.aiKeywordJaccard)
    .filter((v): v is number => v !== null);
  const meanAiKwJaccard = mean(aiKwJaccards);

  // Dim 9b: user_tags preservation
  const userTagJaccards = pairs
    .map((p) => p.userTagJaccard)
    .filter((v): v is number => v !== null);
  const meanUserTagJaccard = mean(userTagJaccards);
  const totalOldUserTags = Array.from(oldMap.values()).reduce(
    (acc, s) => acc + (s.user_tags?.length ?? 0),
    0,
  );
  const totalNewUserTags = Array.from(newMap.values()).reduce(
    (acc, s) => acc + (s.user_tags?.length ?? 0),
    0,
  );

  // Dim 6: Coverage equivalence
  const oldDist = domainDistribution(oldMap.values());
  const newDist = domainDistribution(newMap.values());
  const deltas = domainDeltas(oldDist, newDist);
  const lostDomains = deltas.filter((d) => d.deltaPct < -0.1);

  // Dim 7: Chunk quality (per content type)
  const chunkStatsByType = new Map<string, { count: number; total: number }>();
  for (const [, item] of newMap) {
    const key = item.content_type;
    const agg = chunkStatsByType.get(key) ?? { count: 0, total: 0 };
    agg.count++;
    agg.total += item.chunk_count;
    chunkStatsByType.set(key, agg);
  }
  const articleAvg = chunkStatsByType.get('article');
  const qaAvg = chunkStatsByType.get('question_answer');
  const articleAvgVal = articleAvg && articleAvg.count > 0 ? articleAvg.total / articleAvg.count : NaN;
  const qaAvgVal = qaAvg && qaAvg.count > 0 ? qaAvg.total / qaAvg.count : NaN;

  // ── Dimension table
  const dims: Dim[] = [
    {
      name: 'Structural fidelity',
      metric: 'Items with heading_count ratio ≥ 0.9',
      threshold: '≥ 90%',
      value: fmtPct(headingsPreservedPct),
      status: headingsPreservedPct >= 0.9 ? 'PASS' : 'FAIL',
    },
    {
      name: 'Content completeness',
      metric: 'Median char-count ratio (new/old)',
      threshold: '0.95–1.10',
      value: fmtNum(medianContentRatio, 3),
      status:
        Number.isFinite(medianContentRatio) &&
        medianContentRatio >= 0.95 &&
        medianContentRatio <= 1.1
          ? 'PASS'
          : 'FAIL',
    },
    {
      name: 'Embedding stability',
      metric: 'Median cosine sim / min',
      threshold: 'median > 0.95, min ≥ 0.90',
      value: `${fmtNum(medianSim, 4)} / ${fmtNum(minSim, 4)}`,
      status:
        Number.isFinite(medianSim) && medianSim > 0.95 && minSim >= 0.9
          ? 'PASS'
          : 'FAIL',
    },
    {
      name: 'Classification stability',
      metric: 'Primary-domain match rate',
      threshold: '≥ 95%',
      value: fmtPct(domainMatchPct),
      status: domainMatchPct >= 0.95 ? 'PASS' : 'FAIL',
    },
    {
      name: 'Entity extraction',
      metric: 'Mean Jaccard of canonical_name sets',
      threshold: '> 0.90',
      value: fmtNum(meanJaccard, 3),
      status: Number.isFinite(meanJaccard) && meanJaccard > 0.9 ? 'PASS' : 'FAIL',
    },
    {
      name: 'Coverage equivalence',
      metric: 'Domains losing > 10%',
      threshold: '0 domains',
      value: `${lostDomains.length}`,
      status: lostDomains.length === 0 ? 'PASS' : 'FAIL',
    },
    {
      name: 'Chunk quality (articles)',
      metric: 'Avg chunks per article',
      threshold: '3–20',
      value: fmtNum(articleAvgVal, 2),
      status:
        Number.isFinite(articleAvgVal) && articleAvgVal >= 3 && articleAvgVal <= 20
          ? 'PASS'
          : 'WARN',
    },
    {
      name: 'Chunk quality (Q&A)',
      metric: 'Avg chunks per Q&A',
      threshold: '1',
      value: fmtNum(qaAvgVal, 2),
      status:
        Number.isFinite(qaAvgVal) && qaAvgVal >= 0.95 && qaAvgVal <= 1.1
          ? 'PASS'
          : 'WARN',
    },
    {
      name: 'Body-text completeness',
      metric: 'Items with word_count ratio ≥ 0.9',
      threshold: '≥ 90%',
      value: fmtPct(wcPreservedPct),
      status: wcPreservedPct >= 0.9 ? 'PASS' : 'WARN',
    },
    {
      name: 'AI keyword stability',
      metric: 'Mean Jaccard of ai_keywords sets',
      threshold: '> 0.60',
      value: fmtNum(meanAiKwJaccard, 3),
      status:
        Number.isFinite(meanAiKwJaccard) && meanAiKwJaccard > 0.6 ? 'PASS' : 'WARN',
    },
    {
      name: 'User tags preserved',
      metric: `Mean Jaccard / total old:new (${totalOldUserTags}:${totalNewUserTags})`,
      threshold: 'Jaccard = 1.0 (any loss = FAIL)',
      value: fmtNum(meanUserTagJaccard, 3),
      status:
        userTagJaccards.length === 0
          ? 'N/A'
          : Number.isFinite(meanUserTagJaccard) && meanUserTagJaccard >= 1.0
            ? 'PASS'
            : 'FAIL',
    },
  ];

  lines.push('## Summary');
  lines.push('');
  lines.push('| Dimension | Metric | Threshold | Value | Status |');
  lines.push('|---|---|---|---|---|');
  for (const d of dims) {
    lines.push(`| ${d.name} | ${d.metric} | ${d.threshold} | ${d.value} | ${d.status} |`);
  }
  lines.push('');

  const overallPass = dims.every((d) => d.status === 'PASS' || d.status === 'WARN');
  const anyFail = dims.some((d) => d.status === 'FAIL');
  lines.push(`**Overall:** ${anyFail ? 'FAIL' : overallPass ? 'PASS' : 'INCOMPLETE'}`);
  lines.push('');

  // ── Outliers
  lines.push('## Outliers');
  lines.push('');

  const belowFloor = pairs
    .filter((p) => p.similarity !== null && p.similarity < 0.9)
    .sort((a, b) => (a.similarity ?? 0) - (b.similarity ?? 0))
    .slice(0, 20);
  if (belowFloor.length > 0) {
    lines.push('### Embedding similarity < 0.90');
    lines.push('');
    lines.push('| old_id | new_id | content_type | similarity | content_ratio |');
    lines.push('|---|---|---|---|---|');
    for (const p of belowFloor) {
      lines.push(
        `| ${p.oldId} | ${p.newId} | ${p.content_type} | ${fmtNum(p.similarity ?? NaN, 4)} | ${fmtNum(p.contentRatio ?? NaN, 3)} |`,
      );
    }
    lines.push('');
  }

  const domainMismatches = pairs
    .filter((p) => p.domainMatch === false)
    .slice(0, 20);
  if (domainMismatches.length > 0) {
    lines.push('### Primary domain changed');
    lines.push('');
    lines.push('| old_id | new_id | content_type | old_domain | new_domain |');
    lines.push('|---|---|---|---|---|');
    for (const p of domainMismatches) {
      const oldD = oldMap.get(p.pairKey)?.primary_domain ?? '(null)';
      const newD = newMap.get(p.pairKey)?.primary_domain ?? '(null)';
      lines.push(`| ${p.oldId} | ${p.newId} | ${p.content_type} | ${oldD} | ${newD} |`);
    }
    lines.push('');
  }

  if (lostDomains.length > 0) {
    lines.push('### Domains losing > 10% of items');
    lines.push('');
    lines.push('| domain | old | new | delta |');
    lines.push('|---|---|---|---|');
    for (const d of lostDomains) {
      lines.push(`| ${d.domain} | ${d.oldCount} | ${d.newCount} | ${fmtPct(d.deltaPct)} |`);
    }
    lines.push('');
  }

  // ── Per-type breakdown
  lines.push('## Per-type breakdown');
  lines.push('');
  const byType = new Map<string, PairStat[]>();
  for (const p of pairs) {
    const bucket = byType.get(p.content_type) ?? [];
    bucket.push(p);
    byType.set(p.content_type, bucket);
  }
  lines.push('| content_type | items | median_sim | median_content_ratio | avg_chunks_new |');
  lines.push('|---|---|---|---|---|');
  for (const [ct, ps] of [...byType.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const ctSims = ps
      .map((p) => p.similarity)
      .filter((v): v is number => v !== null);
    const ctRatios = ps
      .map((p) => p.contentRatio)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const chunksAgg = chunkStatsByType.get(ct);
    const avgChunks = chunksAgg && chunksAgg.count > 0 ? chunksAgg.total / chunksAgg.count : NaN;
    lines.push(
      `| ${ct} | ${ps.length} | ${fmtNum(median(ctSims), 4)} | ${fmtNum(median(ctRatios), 3)} | ${fmtNum(avgChunks, 2)} |`,
    );
  }
  lines.push('');

  // ── Domain distribution
  lines.push('## Domain distribution');
  lines.push('');
  lines.push('| domain | old | new | delta |');
  lines.push('|---|---|---|---|');
  for (const d of deltas) {
    lines.push(
      `| ${d.domain} | ${d.oldCount} | ${d.newCount} | ${fmtPct(d.deltaPct)} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const config = parseRuntimeArgs();
  const oldRead = readSnapshot(config.oldPath, config.pairKey);
  const newRead = readSnapshot(config.newPath, config.pairKey);
  const pairs = computePairStats(oldRead.map, newRead.map);

  if (oldRead.collisions > 0 || newRead.collisions > 0) {
    console.error(
      `Pair-key collisions detected (strategy=${config.pairKey}): old=${oldRead.collisions}/${oldRead.total}, new=${newRead.collisions}/${newRead.total}. Duplicate keys kept first-seen.`,
    );
  }

  const report = renderReport(oldRead.map, newRead.map, pairs, config);

  if (config.outputPath) {
    const outDir = path.dirname(config.outputPath);
    if (outDir && !fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(config.outputPath, report);
    console.log(`Wrote report to ${config.outputPath}`);
  } else {
    console.log(report);
  }
}

if (import.meta.main) {
  main();
}
