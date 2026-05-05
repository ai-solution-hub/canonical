import { stripMarkdown } from '@/lib/content/strip-markdown';

/** @public */
export interface PipelineExtractionResult {
  source_url?: string;
  source_file?: string;
  source_format: 'html' | 'pdf' | 'docx' | 'markdown' | 'text' | 'rss';
  title: string;
  content_markdown: string;
  content_plain: string;
  headings: { level: number; text: string; position: number }[];
  word_count: number;
  has_tables: boolean;
  has_code_blocks: boolean;
  extraction_method: string;
  extraction_confidence: 'high' | 'medium' | 'low';
  quality_warnings: string[];
  extracted_at: string;
  extractor_version: string;
}

const EXTRACTOR_VERSION = '1.0.0';

export function createPipelineExtractionResult(
  raw: Pick<
    PipelineExtractionResult,
    | 'source_format'
    | 'title'
    | 'content_markdown'
    | 'extraction_method'
    | 'extraction_confidence'
  > &
    Partial<Pick<PipelineExtractionResult, 'source_url' | 'source_file'>>,
): PipelineExtractionResult {
  const contentPlain = stripMarkdown(raw.content_markdown);
  const wordCount = contentPlain.split(/\s+/).filter(Boolean).length;

  // Extract headings from markdown
  const headings: PipelineExtractionResult['headings'] = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(raw.content_markdown)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      position: match.index,
    });
  }

  // Detect tables and code blocks
  const hasTables = /^\|.+\|$/m.test(raw.content_markdown);
  const hasCodeBlocks = /^```/m.test(raw.content_markdown);

  const warnings: string[] = [];
  if (wordCount < 50) {
    warnings.push('very short content');
  }
  if (headings.length === 0 && wordCount > 200) {
    warnings.push('no headings detected');
  }
  if (raw.source_format === 'pdf' && !hasTables) {
    warnings.push('no tables detected in PDF');
  }
  if (
    contentPlain.length > 0 &&
    raw.content_markdown.length / contentPlain.length > 1.25
  ) {
    warnings.push('high markdown-to-plain ratio');
  }
  if (!raw.title.trim()) {
    warnings.push('empty title');
  }

  return {
    ...raw,
    content_plain: contentPlain,
    headings,
    word_count: wordCount,
    has_tables: hasTables,
    has_code_blocks: hasCodeBlocks,
    quality_warnings: warnings,
    extracted_at: new Date().toISOString(),
    extractor_version: EXTRACTOR_VERSION,
  };
}
