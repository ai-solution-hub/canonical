/**
 * Unit tests for lib/activity/team-changes.ts — the pure
 * form_response_history row → TeamChange / RecentWorkItem mappers shared by
 * `fetchUnifiedDashboardData` (lib/dashboard.ts) and `fetchReorientData`
 * (lib/reorient.ts).
 *
 * ID-145 {145.48}: `form_questions.workspace_id` + its `workspaces` join
 * were DROPPED at {145.6} M3 — `form_questions` no longer relates to
 * `workspaces` at all. These tests assert the mappers now read
 * `form_questions.form_instance_id` (never `workspace_id`) and derive the
 * team-change display title from the joined `form_instances` row (never
 * `workspaces`).
 */
import { describe, it, expect } from 'vitest';
import {
  formResponseRowToTeamChange,
  formResponseRowToRecentWork,
} from '@/lib/activity/team-changes';

describe('formResponseRowToTeamChange', () => {
  it('reads the procurement identifier from form_instance_id, not workspace_id', () => {
    const row = {
      edited_by: 'user-1',
      response_id: 'resp-1',
      created_at: '2026-03-08T09:30:00Z',
      form_responses: {
        question_id: 'q-1',
        form_questions: {
          form_instance_id: 'form-instance-1',
          form_instances: {
            name: 'NHS Digital Procurement',
            issuing_organisation: 'NHS Digital',
          },
        },
      },
    };

    const result = formResponseRowToTeamChange(row);

    expect(result.workspace_id).toBe('form-instance-1');
    // The row never carries a bare `workspace_id` key at all post-{145.6}
    // M3 — asserting the row shape itself has no such property guards
    // against a future select-string regression re-introducing it.
    expect(row.form_responses.form_questions).not.toHaveProperty(
      'workspace_id',
    );
  });

  it('derives entity_title from form_instances.name, not a workspaces join', () => {
    const row = {
      edited_by: 'user-1',
      response_id: 'resp-1',
      created_at: '2026-03-08T09:30:00Z',
      form_responses: {
        question_id: 'q-1',
        form_questions: {
          form_instance_id: 'form-instance-1',
          form_instances: {
            name: 'NHS Digital Procurement',
            issuing_organisation: 'NHS Digital',
          },
        },
      },
    };

    const result = formResponseRowToTeamChange(row);

    expect(result.entity_title).toBe('NHS Digital Procurement');
  });

  it('falls back to issuing_organisation when form_instances.name is null', () => {
    const row = {
      edited_by: 'user-1',
      response_id: 'resp-1',
      created_at: '2026-03-08T09:30:00Z',
      form_responses: {
        question_id: 'q-1',
        form_questions: {
          form_instance_id: 'form-instance-1',
          form_instances: { name: null, issuing_organisation: 'NHS Digital' },
        },
      },
    };

    const result = formResponseRowToTeamChange(row);

    expect(result.entity_title).toBe('NHS Digital');
  });

  it('falls back to "Untitled Procurement" when form_instances is entirely absent', () => {
    const row = {
      edited_by: 'user-1',
      response_id: 'resp-1',
      created_at: '2026-03-08T09:30:00Z',
      form_responses: null,
    };

    const result = formResponseRowToTeamChange(row);

    expect(result.entity_title).toBe('Untitled Procurement');
    expect(result.workspace_id).toBeUndefined();
  });

  it('sets entity_type to bid_response and carries through user/question ids', () => {
    const row = {
      edited_by: 'user-9',
      response_id: 'resp-9',
      created_at: '2026-03-08T09:30:00Z',
      form_responses: {
        question_id: 'q-9',
        form_questions: {
          form_instance_id: 'form-instance-9',
          form_instances: {
            name: 'Test Procurement',
            issuing_organisation: null,
          },
        },
      },
    };

    const result = formResponseRowToTeamChange(row);

    expect(result.entity_type).toBe('bid_response');
    expect(result.user_id).toBe('user-9');
    expect(result.question_id).toBe('q-9');
    expect(result.action).toBe('updated');
  });
});

describe('formResponseRowToRecentWork', () => {
  it('reads the procurement identifier from form_instance_id, not workspace_id', () => {
    const row = {
      response_id: 'resp-2',
      created_at: '2026-03-08T09:15:00Z',
      form_responses: {
        question_id: 'q-2',
        form_questions: {
          form_instance_id: 'form-instance-2',
          question_text: 'Describe your security approach',
        },
      },
    };

    const result = formResponseRowToRecentWork(row);

    expect(result.workspace_id).toBe('form-instance-2');
    expect(row.form_responses.form_questions).not.toHaveProperty(
      'workspace_id',
    );
  });

  it('builds the drill-down href from form_instance_id', () => {
    const row = {
      response_id: 'resp-2',
      created_at: '2026-03-08T09:15:00Z',
      form_responses: {
        question_id: 'q-2',
        form_questions: {
          form_instance_id: 'form-instance-2',
          question_text: 'Describe your security approach',
        },
      },
    };

    const result = formResponseRowToRecentWork(row);

    expect(result.href).toBe('/procurement/form-instance-2/session');
  });

  it('falls back to the /procurement index href when form_instance_id is absent', () => {
    const row = {
      response_id: 'resp-2',
      created_at: '2026-03-08T09:15:00Z',
      form_responses: null,
    };

    const result = formResponseRowToRecentWork(row);

    expect(result.href).toBe('/procurement');
    expect(result.workspace_id).toBeUndefined();
  });

  it('truncates a long question_text into entity_title with an ellipsis', () => {
    const longQuestion =
      "Please provide a detailed description of your organisation's approach to information security management including all relevant certifications";
    const row = {
      response_id: 'resp-3',
      created_at: '2026-03-08T09:00:00Z',
      form_responses: {
        question_id: 'q-3',
        form_questions: {
          form_instance_id: 'form-instance-3',
          question_text: longQuestion,
        },
      },
    };

    const result = formResponseRowToRecentWork(row);

    expect(result.entity_title.length).toBeLessThanOrEqual(60);
    expect(result.entity_title).toMatch(/\.\.\.$/);
  });

  it('sets entity_type to bid_response and carries through question id', () => {
    const row = {
      response_id: 'resp-9',
      created_at: '2026-03-08T09:00:00Z',
      form_responses: {
        question_id: 'q-9',
        form_questions: {
          form_instance_id: 'form-instance-9',
          question_text: 'Q9',
        },
      },
    };

    const result = formResponseRowToRecentWork(row);

    expect(result.entity_type).toBe('bid_response');
    expect(result.action).toBe('edited');
    expect(result.question_id).toBe('q-9');
  });
});
