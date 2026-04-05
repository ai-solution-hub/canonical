/**
 * Search Eval — Vitest Integration
 *
 * This is NOT part of the regular test suite. It runs on demand to measure
 * search quality against hand-curated test cases with relevance judgements.
 *
 * Run with:
 *   EVAL_SEARCH=1 bun run test __tests__/eval/search-eval.test.ts
 *
 * Or skip in normal test runs (default behaviour — describe.skipIf).
 *
 * Note: This test requires OPENAI_API_KEY for embedding generation and
 * SUPABASE_SECRET_KEY for DB access.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Types ──────────────────────────────────────────────────────────

interface SearchTestCase {
  id: string;
  category: string;
  query: string;
  expectations: {
    min_results: number;
    max_results?: number;
    expected_domains: string[];
    expected_subtopics?: string[];
    expected_content_types?: string[];
    must_include_titles: string[];
    notes: string;
  };
  relevance_judgements?: Array<{
    content_item_id: string;
    relevant: boolean;
    score: number;
  }>;
}

interface SearchResult {
  id: string;
  title: string;
  primary_domain: string;
  similarity: number;
}

// ── Test Suite ──────────────────────────────────────────────────────

const isEvalEnabled = process.env.EVAL_SEARCH === '1';

describe.skipIf(!isEvalEnabled)(
  'Search Eval (test cases)',
  () => {
    let testCases: SearchTestCase[];
    let resultsMap: Map<string, SearchResult[]>;

    beforeAll(async () => {
      // Load test cases
      const testCasePath = resolve(
        __dirname,
        '../../scripts/search-evaluation.json',
      );
      const rawData = JSON.parse(readFileSync(testCasePath, 'utf-8'));
      testCases = rawData.test_cases;

      // Initialise clients
      const { createClient } = await import('@supabase/supabase-js');
      const { default: OpenAI } = await import('openai');

      const url =
        process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SECRET_KEY;
      const openaiKey = process.env.OPENAI_API_KEY;

      if (!url || !key) {
        throw new Error(
          'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY for eval',
        );
      }
      if (!openaiKey) {
        throw new Error('Missing OPENAI_API_KEY for search eval');
      }

      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const openai = new OpenAI({ apiKey: openaiKey });

      // Run each search query
      resultsMap = new Map();
      for (const tc of testCases) {
        const embResponse = await openai.embeddings.create({
          model: 'text-embedding-3-large',
          input: tc.query,
          dimensions: 1024,
        });
        const embedding = embResponse.data[0].embedding;

        const { data, error } = await supabase.rpc('hybrid_search', {
          query_embedding: JSON.stringify(embedding),
          query_text: tc.query,
          limit_count: 20,
          similarity_threshold: 0.35,
        });

        if (error) {
          console.error(`Search failed for "${tc.query}":`, error.message);
          resultsMap.set(tc.id, []);
        } else {
          resultsMap.set(tc.id, (data ?? []) as SearchResult[]);
        }
      }
    }, 120_000); // 2 minute timeout for all searches

    it('should meet minimum MRR (>0.40)', () => {
      const casesWithJudgements = testCases.filter(
        (tc) => tc.relevance_judgements && tc.relevance_judgements.length > 0,
      );

      let mrrSum = 0;
      for (const tc of casesWithJudgements) {
        const results = resultsMap.get(tc.id) ?? [];
        const judgementMap = new Map(
          tc.relevance_judgements!.map((j) => [j.content_item_id, j]),
        );

        let caseMrr = 0;
        for (let i = 0; i < results.length; i++) {
          const judgement = judgementMap.get(results[i].id);
          if (judgement?.relevant) {
            caseMrr = 1 / (i + 1);
            break;
          }
        }
        mrrSum += caseMrr;
      }

      const avgMrr =
        casesWithJudgements.length > 0
          ? mrrSum / casesWithJudgements.length
          : 0;
      console.log(
        `MRR: ${(avgMrr * 100).toFixed(1)}% (${casesWithJudgements.length} cases with judgements)`,
      );
      expect(avgMrr).toBeGreaterThan(0.4);
    });

    it('should meet minimum domain accuracy (>0.50)', () => {
      let totalDomainAcc = 0;
      for (const tc of testCases) {
        const results = resultsMap.get(tc.id) ?? [];
        const expectedDomains = new Set(tc.expectations.expected_domains);
        const matches = results.filter((r) =>
          expectedDomains.has(r.primary_domain),
        ).length;
        totalDomainAcc += results.length > 0 ? matches / results.length : 0;
      }

      const avgDomainAcc =
        testCases.length > 0 ? totalDomainAcc / testCases.length : 0;
      console.log(
        `Domain accuracy: ${(avgDomainAcc * 100).toFixed(1)}% (${testCases.length} cases)`,
      );
      expect(avgDomainAcc).toBeGreaterThan(0.5);
    });

    it('should meet min results compliance (>80%)', () => {
      let compliant = 0;
      for (const tc of testCases) {
        const results = resultsMap.get(tc.id) ?? [];
        if (results.length >= tc.expectations.min_results) compliant++;
      }

      const rate = testCases.length > 0 ? compliant / testCases.length : 0;
      console.log(
        `Min results compliance: ${(rate * 100).toFixed(1)}% (${compliant}/${testCases.length})`,
      );
      expect(rate).toBeGreaterThan(0.8);
    });

    it('should have test cases covering all categories', () => {
      const categories = new Set(testCases.map((tc) => tc.category));
      // Expected categories from the search evaluation file
      expect(categories.size).toBeGreaterThanOrEqual(5);
      expect(testCases.length).toBeGreaterThanOrEqual(24);
    });
  },
);
