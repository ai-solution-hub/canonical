/**
 * Predefined extraction schemas for use with the /api/extract endpoint.
 * Each schema defines a JSON structure that Claude will extract from document content.
 */

export const EXTRACTION_SCHEMAS = {
  /** General document structure — headings, sections, key points */
  document_structure: {
    name: 'Document Structure',
    description: 'Extract headings, sections, and key points',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              content: { type: 'string' },
              level: {
                type: 'number',
                description: 'Heading level (1-6)',
              },
            },
          },
        },
        key_findings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Main findings or conclusions',
        },
        summary: { type: 'string', description: 'Brief summary' },
      },
    },
  },

  /** RFP/Bid question extraction — for future bid manager use case */
  bid_questions: {
    name: 'Bid/RFP Questions',
    description: 'Extract questions and requirements from a bid document',
    schema: {
      type: 'object',
      properties: {
        document_title: { type: 'string' },
        issuing_organisation: { type: 'string' },
        deadline: { type: ['string', 'null'] },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Question number or ID',
              },
              text: {
                type: 'string',
                description: 'The question text',
              },
              section: {
                type: 'string',
                description: 'Section the question belongs to',
              },
              required: { type: 'boolean' },
              max_words: {
                type: ['number', 'null'],
                description: 'Word limit if specified',
              },
              weighting: {
                type: ['string', 'null'],
                description: 'Scoring weight if specified',
              },
            },
          },
        },
        total_questions: { type: 'number' },
      },
    },
  },

  /** Meeting notes — attendees, decisions, action items */
  meeting_notes: {
    name: 'Meeting Notes',
    description: 'Extract attendees, decisions, and action items',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: ['string', 'null'] },
        attendees: { type: 'array', items: { type: 'string' } },
        agenda_items: { type: 'array', items: { type: 'string' } },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              decision: { type: 'string' },
              owner: { type: ['string', 'null'] },
            },
          },
        },
        action_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              assignee: { type: ['string', 'null'] },
              deadline: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
  },
} as const;

export type ExtractionSchemaName = keyof typeof EXTRACTION_SCHEMAS;
