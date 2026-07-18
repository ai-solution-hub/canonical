export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      ai_call_events: {
        Row: {
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          cost_usd: number | null
          created_at: string | null
          id: string | null
          input_tokens: number | null
          model: string | null
          outcome_signal: "win" | "fail" | "loop" | "refusal" | null
          output_tokens: number | null
          tier: string | null
          touchpoint_id: string | null
        }
        Insert: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          cost_usd?: number | null
          created_at?: string | null
          id?: string | null
          input_tokens?: number | null
          model?: string | null
          outcome_signal?: "win" | "fail" | "loop" | "refusal" | null
          output_tokens?: number | null
          tier?: string | null
          touchpoint_id?: string | null
        }
        Update: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          cost_usd?: number | null
          created_at?: string | null
          id?: string | null
          input_tokens?: number | null
          model?: string | null
          outcome_signal?: "win" | "fail" | "loop" | "refusal" | null
          output_tokens?: number | null
          tier?: string | null
          touchpoint_id?: string | null
        }
        Relationships: []
      }
      application_types: {
        Row: {
          created_at: string | null
          default_colour: string | null
          default_icon: string | null
          description: string | null
          id: string | null
          key: string | null
          label: string | null
          label_plural: string | null
          provenance: string | null
          state_machine_config: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_colour?: string | null
          default_icon?: string | null
          description?: string | null
          id?: string | null
          key?: string | null
          label?: string | null
          label_plural?: string | null
          provenance?: string | null
          state_machine_config?: Json | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_colour?: string | null
          default_icon?: string | null
          description?: string | null
          id?: string | null
          key?: string | null
          label?: string | null
          label_plural?: string | null
          provenance?: string | null
          state_machine_config?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      change_reports: {
        Row: {
          created_at: string | null
          created_by: string | null
          domain_summaries: Json | null
          frequency: string | null
          generated_at: string | null
          generated_by: string | null
          id: string | null
          item_count: number | null
          item_ids: string[] | null
          metadata: Json | null
          narrative_summary: string | null
          period_end: string | null
          period_start: string | null
          tokens_used: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          domain_summaries?: Json | null
          frequency?: string | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string | null
          item_count?: number | null
          item_ids?: string[] | null
          metadata?: Json | null
          narrative_summary?: string | null
          period_end?: string | null
          period_start?: string | null
          tokens_used?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          domain_summaries?: Json | null
          frequency?: string | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string | null
          item_count?: number | null
          item_ids?: string[] | null
          metadata?: Json | null
          narrative_summary?: string | null
          period_end?: string | null
          period_start?: string | null
          tokens_used?: number | null
        }
        Relationships: []
      }
      citations: {
        Row: {
          citation_type: string | null
          cited_concept_path: string | null
          cited_end: number | null
          cited_kind:
            | "content_item"
            | "q_a_pair"
            | "reference_item"
            | "source_document"
            | "concept"
            | null
          cited_location_kind: string | null
          cited_q_a_pair_id: string | null
          cited_q_a_pair_version: number | null
          cited_reference_item_id: string | null
          cited_source_document_id: string | null
          cited_start: number | null
          cited_text: string | null
          cited_version: number | null
          citing_form_response_id: string | null
          citing_kind: "form_response" | null
          created_at: string | null
          created_by: string | null
          id: string | null
        }
        Insert: {
          citation_type?: string | null
          cited_concept_path?: string | null
          cited_end?: number | null
          cited_kind?:
            | "content_item"
            | "q_a_pair"
            | "reference_item"
            | "source_document"
            | "concept"
            | null
          cited_location_kind?: string | null
          cited_q_a_pair_id?: string | null
          cited_q_a_pair_version?: number | null
          cited_reference_item_id?: string | null
          cited_source_document_id?: string | null
          cited_start?: number | null
          cited_text?: string | null
          cited_version?: number | null
          citing_form_response_id?: string | null
          citing_kind?: "form_response" | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
        }
        Update: {
          citation_type?: string | null
          cited_concept_path?: string | null
          cited_end?: number | null
          cited_kind?:
            | "content_item"
            | "q_a_pair"
            | "reference_item"
            | "source_document"
            | "concept"
            | null
          cited_location_kind?: string | null
          cited_q_a_pair_id?: string | null
          cited_q_a_pair_version?: number | null
          cited_reference_item_id?: string | null
          cited_source_document_id?: string | null
          cited_start?: number | null
          cited_text?: string | null
          cited_version?: number | null
          citing_form_response_id?: string | null
          citing_kind?: "form_response" | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
        }
        Relationships: []
      }
      classification_disputes: {
        Row: {
          created_at: string | null
          current_value: Json | null
          disputed_by: string | null
          disputed_field: string | null
          id: string | null
          proposed_value: Json | null
          rationale: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_document_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_value?: Json | null
          disputed_by?: string | null
          disputed_field?: string | null
          id?: string | null
          proposed_value?: Json | null
          rationale?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_document_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_value?: Json | null
          disputed_by?: string | null
          disputed_field?: string | null
          id?: string | null
          proposed_value?: Json | null
          rationale?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_document_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      company_profiles: {
        Row: {
          certifications: string[] | null
          competitors: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          geographic_scope: string[] | null
          id: string | null
          is_active: boolean | null
          is_primary: boolean | null
          key_topics: string[] | null
          name: string | null
          sectors: string[] | null
          services: string[] | null
          slug: string | null
          target_customers: string | null
          updated_at: string | null
          value_proposition: string | null
          website_url: string | null
        }
        Insert: {
          certifications?: string[] | null
          competitors?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          geographic_scope?: string[] | null
          id?: string | null
          is_active?: boolean | null
          is_primary?: boolean | null
          key_topics?: string[] | null
          name?: string | null
          sectors?: string[] | null
          services?: string[] | null
          slug?: string | null
          target_customers?: string | null
          updated_at?: string | null
          value_proposition?: string | null
          website_url?: string | null
        }
        Update: {
          certifications?: string[] | null
          competitors?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          geographic_scope?: string[] | null
          id?: string | null
          is_active?: boolean | null
          is_primary?: boolean | null
          key_topics?: string[] | null
          name?: string | null
          sectors?: string[] | null
          services?: string[] | null
          slug?: string | null
          target_customers?: string | null
          updated_at?: string | null
          value_proposition?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      content_chunks: {
        Row: {
          char_count: number | null
          content: string | null
          created_at: string | null
          heading_level: number | null
          heading_path: string[] | null
          heading_text: string | null
          id: string | null
          op_id: string | null
          parent_chunk_id: string | null
          position: number | null
          source_document_id: string | null
          updated_at: string | null
          word_count: number | null
        }
        Insert: {
          char_count?: number | null
          content?: string | null
          created_at?: string | null
          heading_level?: number | null
          heading_path?: string[] | null
          heading_text?: string | null
          id?: string | null
          op_id?: string | null
          parent_chunk_id?: string | null
          position?: number | null
          source_document_id?: string | null
          updated_at?: string | null
          word_count?: number | null
        }
        Update: {
          char_count?: number | null
          content?: string | null
          created_at?: string | null
          heading_level?: number | null
          heading_path?: string[] | null
          heading_text?: string | null
          id?: string | null
          op_id?: string | null
          parent_chunk_id?: string | null
          position?: number | null
          source_document_id?: string | null
          updated_at?: string | null
          word_count?: number | null
        }
        Relationships: []
      }
      content_propagation_version: {
        Row: {
          applied_at: string | null
          payload_checksum: string | null
          payload_key: string | null
          version: number | null
        }
        Insert: {
          applied_at?: string | null
          payload_checksum?: string | null
          payload_key?: string | null
          version?: number | null
        }
        Update: {
          applied_at?: string | null
          payload_checksum?: string | null
          payload_key?: string | null
          version?: number | null
        }
        Relationships: []
      }
      coverage_targets: {
        Row: {
          created_at: string | null
          created_by: string | null
          domain_id: string | null
          id: string | null
          metric_name: string | null
          target_value: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          domain_id?: string | null
          id?: string | null
          metric_name?: string | null
          target_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          domain_id?: string | null
          id?: string | null
          metric_name?: string | null
          target_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      engagement_group_content: {
        Row: {
          created_at: string | null
          engagement_group_id: string | null
          id: string | null
          q_a_pair_id: string | null
        }
        Insert: {
          created_at?: string | null
          engagement_group_id?: string | null
          id?: string | null
          q_a_pair_id?: string | null
        }
        Update: {
          created_at?: string | null
          engagement_group_id?: string | null
          id?: string | null
          q_a_pair_id?: string | null
        }
        Relationships: []
      }
      engagement_groups: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string | null
          name: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      entity_aliases: {
        Row: {
          alias: string | null
          canonical: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          provenance: string | null
        }
        Insert: {
          alias?: string | null
          canonical?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          provenance?: string | null
        }
        Update: {
          alias?: string | null
          canonical?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          provenance?: string | null
        }
        Relationships: []
      }
      entity_mentions: {
        Row: {
          canonical_name: string | null
          confidence: number | null
          context_snippet: string | null
          created_at: string | null
          entity_name: string | null
          entity_type: string | null
          entity_type_override: string | null
          id: string | null
          metadata: Json | null
          normalisation_version: number | null
          op_id: string | null
          source_document_id: string | null
          updated_at: string | null
        }
        Insert: {
          canonical_name?: string | null
          confidence?: number | null
          context_snippet?: string | null
          created_at?: string | null
          entity_name?: string | null
          entity_type?: string | null
          entity_type_override?: string | null
          id?: string | null
          metadata?: Json | null
          normalisation_version?: number | null
          op_id?: string | null
          source_document_id?: string | null
          updated_at?: string | null
        }
        Update: {
          canonical_name?: string | null
          confidence?: number | null
          context_snippet?: string | null
          created_at?: string | null
          entity_name?: string | null
          entity_type?: string | null
          entity_type_override?: string | null
          id?: string | null
          metadata?: Json | null
          normalisation_version?: number | null
          op_id?: string | null
          source_document_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      entity_relationships: {
        Row: {
          confidence: number | null
          created_at: string | null
          id: string | null
          relationship_type: string | null
          source_document_id: string | null
          source_entity: string | null
          target_entity: string | null
          updated_at: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          id?: string | null
          relationship_type?: string | null
          source_document_id?: string | null
          source_entity?: string | null
          target_entity?: string | null
          updated_at?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          id?: string | null
          relationship_type?: string | null
          source_document_id?: string | null
          source_entity?: string | null
          target_entity?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      eval_baseline_audit: {
        Row: {
          action: string | null
          actor: string | null
          at: string | null
          id: string | null
          registry_version: number | null
          touchpoint_id: string | null
        }
        Insert: {
          action?: string | null
          actor?: string | null
          at?: string | null
          id?: string | null
          registry_version?: number | null
          touchpoint_id?: string | null
        }
        Update: {
          action?: string | null
          actor?: string | null
          at?: string | null
          id?: string | null
          registry_version?: number | null
          touchpoint_id?: string | null
        }
        Relationships: []
      }
      eval_baselines: {
        Row: {
          id: string | null
          metrics: Json | null
          promoted_at: string | null
          promoted_by: string | null
          registry_version: number | null
          thresholds: Json | null
          touchpoint_id: string | null
        }
        Insert: {
          id?: string | null
          metrics?: Json | null
          promoted_at?: string | null
          promoted_by?: string | null
          registry_version?: number | null
          thresholds?: Json | null
          touchpoint_id?: string | null
        }
        Update: {
          id?: string | null
          metrics?: Json | null
          promoted_at?: string | null
          promoted_by?: string | null
          registry_version?: number | null
          thresholds?: Json | null
          touchpoint_id?: string | null
        }
        Relationships: []
      }
      eval_runs: {
        Row: {
          exit_class: number | null
          id: string | null
          metrics: Json | null
          passed: boolean | null
          run_at: string | null
          severity_disposition: string | null
          source: string | null
          touchpoint_id: string | null
        }
        Insert: {
          exit_class?: number | null
          id?: string | null
          metrics?: Json | null
          passed?: boolean | null
          run_at?: string | null
          severity_disposition?: string | null
          source?: string | null
          touchpoint_id?: string | null
        }
        Update: {
          exit_class?: number | null
          id?: string | null
          metrics?: Json | null
          passed?: boolean | null
          run_at?: string | null
          severity_disposition?: string | null
          source?: string | null
          touchpoint_id?: string | null
        }
        Relationships: []
      }
      eval_touchpoints: {
        Row: {
          contract_version: number | null
          created_at: string | null
          file_sha256: string | null
          graduation_metric: string | null
          grounding_shape: string | null
          kind: string | null
          owner: string | null
          registry_version: number | null
          severity_on_fail: string | null
          suite_name: string | null
          touchpoint_id: string | null
          updated_at: string | null
          variance_band: number | null
        }
        Insert: {
          contract_version?: number | null
          created_at?: string | null
          file_sha256?: string | null
          graduation_metric?: string | null
          grounding_shape?: string | null
          kind?: string | null
          owner?: string | null
          registry_version?: number | null
          severity_on_fail?: string | null
          suite_name?: string | null
          touchpoint_id?: string | null
          updated_at?: string | null
          variance_band?: number | null
        }
        Update: {
          contract_version?: number | null
          created_at?: string | null
          file_sha256?: string | null
          graduation_metric?: string | null
          grounding_shape?: string | null
          kind?: string | null
          owner?: string | null
          registry_version?: number | null
          severity_on_fail?: string | null
          suite_name?: string | null
          touchpoint_id?: string | null
          updated_at?: string | null
          variance_band?: number | null
        }
        Relationships: []
      }
      feed_articles: {
        Row: {
          ai_summary: string | null
          created_at: string | null
          external_id: string | null
          external_url: string | null
          extraction_method: string | null
          feed_source_id: string | null
          id: string | null
          ingested_at: string | null
          matched_categories: string[] | null
          passed: boolean | null
          prompt_version_id: string | null
          published_at: string | null
          raw_content: string | null
          reference_item_id: string | null
          relevance_category: string | null
          relevance_reasoning: string | null
          relevance_score: number | null
          title: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string | null
          external_id?: string | null
          external_url?: string | null
          extraction_method?: string | null
          feed_source_id?: string | null
          id?: string | null
          ingested_at?: string | null
          matched_categories?: string[] | null
          passed?: boolean | null
          prompt_version_id?: string | null
          published_at?: string | null
          raw_content?: string | null
          reference_item_id?: string | null
          relevance_category?: string | null
          relevance_reasoning?: string | null
          relevance_score?: number | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          ai_summary?: string | null
          created_at?: string | null
          external_id?: string | null
          external_url?: string | null
          extraction_method?: string | null
          feed_source_id?: string | null
          id?: string | null
          ingested_at?: string | null
          matched_categories?: string[] | null
          passed?: boolean | null
          prompt_version_id?: string | null
          published_at?: string | null
          raw_content?: string | null
          reference_item_id?: string | null
          relevance_category?: string | null
          relevance_reasoning?: string | null
          relevance_score?: number | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      feed_flags: {
        Row: {
          created_at: string | null
          feed_article_id: string | null
          flag_type: string | null
          flagged_by: string | null
          id: string | null
          notes: string | null
          prompt_version_id: string | null
          resolution_type: string | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_notes: string | null
        }
        Insert: {
          created_at?: string | null
          feed_article_id?: string | null
          flag_type?: string | null
          flagged_by?: string | null
          id?: string | null
          notes?: string | null
          prompt_version_id?: string | null
          resolution_type?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_notes?: string | null
        }
        Update: {
          created_at?: string | null
          feed_article_id?: string | null
          flag_type?: string | null
          flagged_by?: string | null
          id?: string | null
          notes?: string | null
          prompt_version_id?: string | null
          resolution_type?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_notes?: string | null
        }
        Relationships: []
      }
      feed_prompts: {
        Row: {
          change_notes: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          is_active: boolean | null
          performance_snapshot: Json | null
          prompt_text: string | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          change_notes?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          is_active?: boolean | null
          performance_snapshot?: Json | null
          prompt_text?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          change_notes?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          is_active?: boolean | null
          performance_snapshot?: Json | null
          prompt_text?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      feed_sources: {
        Row: {
          article_count: number | null
          consecutive_failures: number | null
          created_at: string | null
          created_by: string | null
          etag: string | null
          id: string | null
          is_active: boolean | null
          last_modified: string | null
          last_polled_at: string | null
          last_polled_error: string | null
          last_polled_status: string | null
          name: string | null
          polling_interval_minutes: number | null
          source_type: string | null
          updated_at: string | null
          url: string | null
          workspace_id: string | null
        }
        Insert: {
          article_count?: number | null
          consecutive_failures?: number | null
          created_at?: string | null
          created_by?: string | null
          etag?: string | null
          id?: string | null
          is_active?: boolean | null
          last_modified?: string | null
          last_polled_at?: string | null
          last_polled_error?: string | null
          last_polled_status?: string | null
          name?: string | null
          polling_interval_minutes?: number | null
          source_type?: string | null
          updated_at?: string | null
          url?: string | null
          workspace_id?: string | null
        }
        Update: {
          article_count?: number | null
          consecutive_failures?: number | null
          created_at?: string | null
          created_by?: string | null
          etag?: string | null
          id?: string | null
          is_active?: boolean | null
          last_modified?: string | null
          last_polled_at?: string | null
          last_polled_error?: string | null
          last_polled_status?: string | null
          name?: string | null
          polling_interval_minutes?: number | null
          source_type?: string | null
          updated_at?: string | null
          url?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      form_attachments: {
        Row: {
          created_at: string | null
          created_by: string | null
          engagement_group_id: string | null
          file_size: number | null
          filename: string | null
          form_instance_id: string | null
          id: string | null
          mime_type: string | null
          role: string | null
          storage_path: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          engagement_group_id?: string | null
          file_size?: number | null
          filename?: string | null
          form_instance_id?: string | null
          id?: string | null
          mime_type?: string | null
          role?: string | null
          storage_path?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          engagement_group_id?: string | null
          file_size?: number | null
          filename?: string | null
          form_instance_id?: string | null
          id?: string | null
          mime_type?: string | null
          role?: string | null
          storage_path?: string | null
        }
        Relationships: []
      }
      form_instance_fields: {
        Row: {
          col_index: number | null
          created_at: string | null
          field_type: string | null
          fill_error: string | null
          fill_status: string | null
          form_instance_id: string | null
          geometry: Json | null
          id: string | null
          is_mandatory: boolean | null
          mapping_confidence: number | null
          mapping_status: string | null
          placeholder_text: string | null
          question_id: string | null
          question_text: string | null
          reference_urls: string[] | null
          row_index: number | null
          section_name: string | null
          sequence: number | null
          table_index: number | null
          updated_at: string | null
          word_limit: number | null
        }
        Insert: {
          col_index?: number | null
          created_at?: string | null
          field_type?: string | null
          fill_error?: string | null
          fill_status?: string | null
          form_instance_id?: string | null
          geometry?: Json | null
          id?: string | null
          is_mandatory?: boolean | null
          mapping_confidence?: number | null
          mapping_status?: string | null
          placeholder_text?: string | null
          question_id?: string | null
          question_text?: string | null
          reference_urls?: string[] | null
          row_index?: number | null
          section_name?: string | null
          sequence?: number | null
          table_index?: number | null
          updated_at?: string | null
          word_limit?: number | null
        }
        Update: {
          col_index?: number | null
          created_at?: string | null
          field_type?: string | null
          fill_error?: string | null
          fill_status?: string | null
          form_instance_id?: string | null
          geometry?: Json | null
          id?: string | null
          is_mandatory?: boolean | null
          mapping_confidence?: number | null
          mapping_status?: string | null
          placeholder_text?: string | null
          question_id?: string | null
          question_text?: string | null
          reference_urls?: string[] | null
          row_index?: number | null
          section_name?: string | null
          sequence?: number | null
          table_index?: number | null
          updated_at?: string | null
          word_limit?: number | null
        }
        Relationships: []
      }
      form_instances: {
        Row: {
          created_at: string | null
          created_by: string | null
          deadline: string | null
          description: string | null
          engagement_group_id: string | null
          estimated_value: number | null
          evaluation_methodology: string | null
          field_count: number | null
          file_size: number | null
          filename: string | null
          form_type: string | null
          id: string | null
          ingest_source: string | null
          issuing_organisation: string | null
          mapped_count: number | null
          mime_type: string | null
          name: string | null
          outcome: string | null
          outcome_notes: string | null
          outcome_recorded_at: string | null
          outcome_recorded_by: string | null
          processing_status: string | null
          reference_number: string | null
          status_reason: string | null
          storage_path: string | null
          structure_path: string | null
          submission_date: string | null
          updated_at: string | null
          workflow_state: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          engagement_group_id?: string | null
          estimated_value?: number | null
          evaluation_methodology?: string | null
          field_count?: number | null
          file_size?: number | null
          filename?: string | null
          form_type?: string | null
          id?: string | null
          ingest_source?: string | null
          issuing_organisation?: string | null
          mapped_count?: number | null
          mime_type?: string | null
          name?: string | null
          outcome?: string | null
          outcome_notes?: string | null
          outcome_recorded_at?: string | null
          outcome_recorded_by?: string | null
          processing_status?: string | null
          reference_number?: string | null
          status_reason?: string | null
          storage_path?: string | null
          structure_path?: string | null
          submission_date?: string | null
          updated_at?: string | null
          workflow_state?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          engagement_group_id?: string | null
          estimated_value?: number | null
          evaluation_methodology?: string | null
          field_count?: number | null
          file_size?: number | null
          filename?: string | null
          form_type?: string | null
          id?: string | null
          ingest_source?: string | null
          issuing_organisation?: string | null
          mapped_count?: number | null
          mime_type?: string | null
          name?: string | null
          outcome?: string | null
          outcome_notes?: string | null
          outcome_recorded_at?: string | null
          outcome_recorded_by?: string | null
          processing_status?: string | null
          reference_number?: string | null
          status_reason?: string | null
          storage_path?: string | null
          structure_path?: string | null
          submission_date?: string | null
          updated_at?: string | null
          workflow_state?: string | null
        }
        Relationships: []
      }
      form_outcome_types: {
        Row: {
          applicable_form_types: string[] | null
          counts_toward_win_rate: boolean | null
          key: string | null
          label: string | null
          provenance: string | null
          stage: string | null
        }
        Insert: {
          applicable_form_types?: string[] | null
          counts_toward_win_rate?: boolean | null
          key?: string | null
          label?: string | null
          provenance?: string | null
          stage?: string | null
        }
        Update: {
          applicable_form_types?: string[] | null
          counts_toward_win_rate?: boolean | null
          key?: string | null
          label?: string | null
          provenance?: string | null
          stage?: string | null
        }
        Relationships: []
      }
      form_questions: {
        Row: {
          assigned_to: string | null
          confidence_posture: string | null
          created_at: string | null
          created_by: string | null
          evaluation_weight: number | null
          form_instance_id: string | null
          has_variants: boolean | null
          id: string | null
          question_sequence: number | null
          question_text: string | null
          section_name: string | null
          section_sequence: number | null
          status: string | null
          template_requirement_id: string | null
          updated_at: string | null
          word_limit: number | null
        }
        Insert: {
          assigned_to?: string | null
          confidence_posture?: string | null
          created_at?: string | null
          created_by?: string | null
          evaluation_weight?: number | null
          form_instance_id?: string | null
          has_variants?: boolean | null
          id?: string | null
          question_sequence?: number | null
          question_text?: string | null
          section_name?: string | null
          section_sequence?: number | null
          status?: string | null
          template_requirement_id?: string | null
          updated_at?: string | null
          word_limit?: number | null
        }
        Update: {
          assigned_to?: string | null
          confidence_posture?: string | null
          created_at?: string | null
          created_by?: string | null
          evaluation_weight?: number | null
          form_instance_id?: string | null
          has_variants?: boolean | null
          id?: string | null
          question_sequence?: number | null
          question_text?: string | null
          section_name?: string | null
          section_sequence?: number | null
          status?: string | null
          template_requirement_id?: string | null
          updated_at?: string | null
          word_limit?: number | null
        }
        Relationships: []
      }
      form_requirement_templates: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string | null
          is_current: boolean | null
          is_mandatory: boolean | null
          matching_guidance: string | null
          matching_keywords: string[] | null
          primary_domain: string | null
          primary_subtopic: string | null
          question_number: number | null
          requirement_text: string | null
          requirement_type: string | null
          secondary_domain: string | null
          secondary_subtopic: string | null
          section_name: string | null
          section_ref: string | null
          sector_applicability: string[] | null
          template_name: string | null
          template_type: string | null
          template_version: string | null
          updated_at: string | null
          word_limit_guidance: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string | null
          is_current?: boolean | null
          is_mandatory?: boolean | null
          matching_guidance?: string | null
          matching_keywords?: string[] | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          question_number?: number | null
          requirement_text?: string | null
          requirement_type?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          section_name?: string | null
          section_ref?: string | null
          sector_applicability?: string[] | null
          template_name?: string | null
          template_type?: string | null
          template_version?: string | null
          updated_at?: string | null
          word_limit_guidance?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string | null
          is_current?: boolean | null
          is_mandatory?: boolean | null
          matching_guidance?: string | null
          matching_keywords?: string[] | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          question_number?: number | null
          requirement_text?: string | null
          requirement_type?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          section_name?: string | null
          section_ref?: string | null
          sector_applicability?: string[] | null
          template_name?: string | null
          template_type?: string | null
          template_version?: string | null
          updated_at?: string | null
          word_limit_guidance?: number | null
        }
        Relationships: []
      }
      form_response_history: {
        Row: {
          change_reason: string | null
          created_at: string | null
          edited_by: string | null
          id: string | null
          metadata: Json | null
          response_id: string | null
          response_text: string | null
          response_text_advanced: string | null
          review_status: string | null
          source_record_ids: string[] | null
          version: number | null
        }
        Insert: {
          change_reason?: string | null
          created_at?: string | null
          edited_by?: string | null
          id?: string | null
          metadata?: Json | null
          response_id?: string | null
          response_text?: string | null
          response_text_advanced?: string | null
          review_status?: string | null
          source_record_ids?: string[] | null
          version?: number | null
        }
        Update: {
          change_reason?: string | null
          created_at?: string | null
          edited_by?: string | null
          id?: string | null
          metadata?: Json | null
          response_id?: string | null
          response_text?: string | null
          response_text_advanced?: string | null
          review_status?: string | null
          source_record_ids?: string[] | null
          version?: number | null
        }
        Relationships: []
      }
      form_responses: {
        Row: {
          approved_by: string | null
          created_at: string | null
          drafted_by: string | null
          id: string | null
          last_edited_by: string | null
          metadata: Json | null
          overall_score: number | null
          question_id: string | null
          response_text: string | null
          response_text_advanced: string | null
          review_status: string | null
          source_record_ids: string[] | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          approved_by?: string | null
          created_at?: string | null
          drafted_by?: string | null
          id?: string | null
          last_edited_by?: string | null
          metadata?: Json | null
          overall_score?: number | null
          question_id?: string | null
          response_text?: string | null
          response_text_advanced?: string | null
          review_status?: string | null
          source_record_ids?: string[] | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          approved_by?: string | null
          created_at?: string | null
          drafted_by?: string | null
          id?: string | null
          last_edited_by?: string | null
          metadata?: Json | null
          overall_score?: number | null
          question_id?: string | null
          response_text?: string | null
          response_text_advanced?: string | null
          review_status?: string | null
          source_record_ids?: string[] | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      form_types: {
        Row: {
          applicable_application_types: string[] | null
          created_at: string | null
          key: string | null
          label: string | null
          provenance: string | null
        }
        Insert: {
          applicable_application_types?: string[] | null
          created_at?: string | null
          key?: string | null
          label?: string | null
          provenance?: string | null
        }
        Update: {
          applicable_application_types?: string[] | null
          created_at?: string | null
          key?: string | null
          label?: string | null
          provenance?: string | null
        }
        Relationships: []
      }
      governance_config: {
        Row: {
          auto_flag_cooldown_days: number | null
          auto_flag_on_freshness_transition: boolean | null
          auto_flag_on_quality_drop: boolean | null
          created_at: string | null
          created_by: string | null
          domain: string | null
          id: string | null
          posture: string | null
          preset: string | null
          quality_score_threshold: number | null
          reviewer_id: string | null
          timeout_days: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          auto_flag_cooldown_days?: number | null
          auto_flag_on_freshness_transition?: boolean | null
          auto_flag_on_quality_drop?: boolean | null
          created_at?: string | null
          created_by?: string | null
          domain?: string | null
          id?: string | null
          posture?: string | null
          preset?: string | null
          quality_score_threshold?: number | null
          reviewer_id?: string | null
          timeout_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          auto_flag_cooldown_days?: number | null
          auto_flag_on_freshness_transition?: boolean | null
          auto_flag_on_quality_drop?: boolean | null
          created_at?: string | null
          created_by?: string | null
          domain?: string | null
          id?: string | null
          posture?: string | null
          preset?: string | null
          quality_score_threshold?: number | null
          reviewer_id?: string | null
          timeout_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      guide_sections: {
        Row: {
          content_type_filter: string | null
          created_at: string | null
          description: string | null
          display_order: number | null
          expected_layer: string | null
          guide_id: string | null
          id: string | null
          is_required: boolean | null
          parent_section_id: string | null
          section_name: string | null
          subtopic_filter: string | null
          updated_at: string | null
        }
        Insert: {
          content_type_filter?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          expected_layer?: string | null
          guide_id?: string | null
          id?: string | null
          is_required?: boolean | null
          parent_section_id?: string | null
          section_name?: string | null
          subtopic_filter?: string | null
          updated_at?: string | null
        }
        Update: {
          content_type_filter?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          expected_layer?: string | null
          guide_id?: string | null
          id?: string | null
          is_required?: boolean | null
          parent_section_id?: string | null
          section_name?: string | null
          subtopic_filter?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      guides: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          domain_filter: string | null
          guide_type: string | null
          icon: string | null
          id: string | null
          is_published: boolean | null
          name: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          domain_filter?: string | null
          guide_type?: string | null
          icon?: string | null
          id?: string | null
          is_published?: boolean | null
          name?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          domain_filter?: string | null
          guide_type?: string | null
          icon?: string | null
          id?: string | null
          is_published?: boolean | null
          name?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ingestion_quality_log: {
        Row: {
          created_at: string | null
          created_by: string | null
          details: Json | null
          flag_type: string | null
          id: string | null
          ingestion_batch: string | null
          resolution_notes: string | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string | null
          source_document_id: string | null
          source_url: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          flag_type?: string | null
          id?: string | null
          ingestion_batch?: string | null
          resolution_notes?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          source_document_id?: string | null
          source_url?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          flag_type?: string | null
          id?: string | null
          ingestion_batch?: string | null
          resolution_notes?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          source_document_id?: string | null
          source_url?: string | null
        }
        Relationships: []
      }
      intelligence_workspaces: {
        Row: {
          company_profile_id: string | null
          created_at: string | null
          guide_id: string | null
          id: string | null
          relevance_threshold: number | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          company_profile_id?: string | null
          created_at?: string | null
          guide_id?: string | null
          id?: string | null
          relevance_threshold?: number | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          company_profile_id?: string | null
          created_at?: string | null
          guide_id?: string | null
          id?: string | null
          relevance_threshold?: number | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      layer_vocabulary: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string | null
          is_active: boolean | null
          key: string | null
          label: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string | null
          is_active?: boolean | null
          key?: string | null
          label?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string | null
          is_active?: boolean | null
          key?: string | null
          label?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string | null
          message: string | null
          read_at: string | null
          title: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string | null
          message?: string | null
          read_at?: string | null
          title?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string | null
          message?: string | null
          read_at?: string | null
          title?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          completed_at: string | null
          cost: number | null
          created_at: string | null
          created_by: string | null
          ended_at: string | null
          error_message: string | null
          id: string | null
          items_created: string[] | null
          items_processed: number | null
          items_skipped: number | null
          items_updated: number | null
          op_id: string | null
          pipeline_name: string | null
          progress: Json | null
          result: Json | null
          source_filename: string | null
          started_at: string | null
          status: string | null
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          ended_at?: string | null
          error_message?: string | null
          id?: string | null
          items_created?: string[] | null
          items_processed?: number | null
          items_skipped?: number | null
          items_updated?: number | null
          op_id?: string | null
          pipeline_name?: string | null
          progress?: Json | null
          result?: Json | null
          source_filename?: string | null
          started_at?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          ended_at?: string | null
          error_message?: string | null
          id?: string | null
          items_created?: string[] | null
          items_processed?: number | null
          items_skipped?: number | null
          items_updated?: number | null
          op_id?: string | null
          pipeline_name?: string | null
          progress?: Json | null
          result?: Json | null
          source_filename?: string | null
          started_at?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      processing_queue: {
        Row: {
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error_message: string | null
          id: string | null
          idempotency_key: string | null
          job_type: string | null
          max_attempts: number | null
          payload: Json | null
          priority: number | null
          result: Json | null
          started_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          id?: string | null
          idempotency_key?: string | null
          job_type?: string | null
          max_attempts?: number | null
          payload?: Json | null
          priority?: number | null
          result?: Json | null
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          id?: string | null
          idempotency_key?: string | null
          job_type?: string | null
          max_attempts?: number | null
          payload?: Json | null
          priority?: number | null
          result?: Json | null
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      promotion_dispositions: {
        Row: {
          action: string | null
          actor: string | null
          created_at: string | null
          extraction_id: string | null
          id: string | null
          proposed_snapshot: Json | null
        }
        Insert: {
          action?: string | null
          actor?: string | null
          created_at?: string | null
          extraction_id?: string | null
          id?: string | null
          proposed_snapshot?: Json | null
        }
        Update: {
          action?: string | null
          actor?: string | null
          created_at?: string | null
          extraction_id?: string | null
          id?: string | null
          proposed_snapshot?: Json | null
        }
        Relationships: []
      }
      q_a_extractions: {
        Row: {
          alternate_question_phrasings: string[] | null
          created_at: string | null
          evaluation_criteria: string | null
          evidence_requirements: string[] | null
          expected_response_kind: string | null
          extracted_answer_text: string | null
          extracted_question_text: string | null
          extraction_metadata: Json | null
          extractor_kind: string | null
          id: string | null
          invalidated_at: string | null
          op_id: string | null
          promoted_to_pair_id: string | null
          scope_tags: string[] | null
          source_document_id: string | null
          updated_at: string | null
        }
        Insert: {
          alternate_question_phrasings?: string[] | null
          created_at?: string | null
          evaluation_criteria?: string | null
          evidence_requirements?: string[] | null
          expected_response_kind?: string | null
          extracted_answer_text?: string | null
          extracted_question_text?: string | null
          extraction_metadata?: Json | null
          extractor_kind?: string | null
          id?: string | null
          invalidated_at?: string | null
          op_id?: string | null
          promoted_to_pair_id?: string | null
          scope_tags?: string[] | null
          source_document_id?: string | null
          updated_at?: string | null
        }
        Update: {
          alternate_question_phrasings?: string[] | null
          created_at?: string | null
          evaluation_criteria?: string | null
          evidence_requirements?: string[] | null
          expected_response_kind?: string | null
          extracted_answer_text?: string | null
          extracted_question_text?: string | null
          extraction_metadata?: Json | null
          extractor_kind?: string | null
          id?: string | null
          invalidated_at?: string | null
          op_id?: string | null
          promoted_to_pair_id?: string | null
          scope_tags?: string[] | null
          source_document_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      q_a_pair_dedup_proposals: {
        Row: {
          created_at: string | null
          id: string | null
          pair_a_fingerprint: string | null
          pair_a_id: string | null
          pair_a_source_form_response_id: string | null
          pair_b_fingerprint: string | null
          pair_b_id: string | null
          pair_b_source_form_response_id: string | null
          proposed_survivor_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_survivor_id: string | null
          similarity_score: number | null
          status: string | null
          survivor_reason: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          pair_a_fingerprint?: string | null
          pair_a_id?: string | null
          pair_a_source_form_response_id?: string | null
          pair_b_fingerprint?: string | null
          pair_b_id?: string | null
          pair_b_source_form_response_id?: string | null
          proposed_survivor_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_survivor_id?: string | null
          similarity_score?: number | null
          status?: string | null
          survivor_reason?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          pair_a_fingerprint?: string | null
          pair_a_id?: string | null
          pair_a_source_form_response_id?: string | null
          pair_b_fingerprint?: string | null
          pair_b_id?: string | null
          pair_b_source_form_response_id?: string | null
          proposed_survivor_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_survivor_id?: string | null
          similarity_score?: number | null
          status?: string | null
          survivor_reason?: string | null
        }
        Relationships: []
      }
      q_a_pair_history: {
        Row: {
          alternate_question_phrasings: string[] | null
          answer_advanced: string | null
          answer_standard: string | null
          anti_scope_tag: string[] | null
          changed_at: string | null
          changed_by: string | null
          edit_intent: string | null
          id: string | null
          origin_kind: string | null
          publication_status: string | null
          q_a_pair_id: string | null
          question_text: string | null
          scope_tag: string[] | null
          source_workspace_id: string | null
          superseded_by: string | null
          valid_from: string | null
          valid_to: string | null
          version: number | null
        }
        Insert: {
          alternate_question_phrasings?: string[] | null
          answer_advanced?: string | null
          answer_standard?: string | null
          anti_scope_tag?: string[] | null
          changed_at?: string | null
          changed_by?: string | null
          edit_intent?: string | null
          id?: string | null
          origin_kind?: string | null
          publication_status?: string | null
          q_a_pair_id?: string | null
          question_text?: string | null
          scope_tag?: string[] | null
          source_workspace_id?: string | null
          superseded_by?: string | null
          valid_from?: string | null
          valid_to?: string | null
          version?: number | null
        }
        Update: {
          alternate_question_phrasings?: string[] | null
          answer_advanced?: string | null
          answer_standard?: string | null
          anti_scope_tag?: string[] | null
          changed_at?: string | null
          changed_by?: string | null
          edit_intent?: string | null
          id?: string | null
          origin_kind?: string | null
          publication_status?: string | null
          q_a_pair_id?: string | null
          question_text?: string | null
          scope_tag?: string[] | null
          source_workspace_id?: string | null
          superseded_by?: string | null
          valid_from?: string | null
          valid_to?: string | null
          version?: number | null
        }
        Relationships: []
      }
      q_a_pairs: {
        Row: {
          alternate_question_phrasings: string[] | null
          answer_advanced: string | null
          answer_standard: string | null
          anti_scope_tag: string[] | null
          created_at: string | null
          edit_intent: string | null
          id: string | null
          origin_kind: string | null
          publication_status: string | null
          question_text: string | null
          scope_tag: string[] | null
          source_document_id: string | null
          source_form_instance_id: string | null
          source_form_response_id: string | null
          source_question_id: string | null
          superseded_by: string | null
          updated_at: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          alternate_question_phrasings?: string[] | null
          answer_advanced?: string | null
          answer_standard?: string | null
          anti_scope_tag?: string[] | null
          created_at?: string | null
          edit_intent?: string | null
          id?: string | null
          origin_kind?: string | null
          publication_status?: string | null
          question_text?: string | null
          scope_tag?: string[] | null
          source_document_id?: string | null
          source_form_instance_id?: string | null
          source_form_response_id?: string | null
          source_question_id?: string | null
          superseded_by?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          alternate_question_phrasings?: string[] | null
          answer_advanced?: string | null
          answer_standard?: string | null
          anti_scope_tag?: string[] | null
          created_at?: string | null
          edit_intent?: string | null
          id?: string | null
          origin_kind?: string | null
          publication_status?: string | null
          question_text?: string | null
          scope_tag?: string[] | null
          source_document_id?: string | null
          source_form_instance_id?: string | null
          source_form_response_id?: string | null
          source_question_id?: string | null
          superseded_by?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      record_embeddings: {
        Row: {
          created_at: string | null
          embedding: string | null
          id: string | null
          model: string | null
          owner_id: string | null
          owner_kind: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          embedding?: string | null
          id?: string | null
          model?: string | null
          owner_id?: string | null
          owner_kind?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          embedding?: string | null
          id?: string | null
          model?: string | null
          owner_id?: string | null
          owner_kind?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      record_lifecycle: {
        Row: {
          content_owner_id: string | null
          created_at: string | null
          domain: string | null
          expiry_date: string | null
          freshness: string | null
          freshness_checked_at: string | null
          governance_review_due: string | null
          governance_review_status: string | null
          governance_reviewer_id: string | null
          id: string | null
          lifecycle_type: string | null
          next_review_date: string | null
          owner_id: string | null
          owner_kind: string | null
          previous_freshness: string | null
          q_a_pair_id: string | null
          review_cadence_days: number | null
          source_document_id: string | null
          updated_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          content_owner_id?: string | null
          created_at?: string | null
          domain?: string | null
          expiry_date?: string | null
          freshness?: string | null
          freshness_checked_at?: string | null
          governance_review_due?: string | null
          governance_review_status?: string | null
          governance_reviewer_id?: string | null
          id?: string | null
          lifecycle_type?: string | null
          next_review_date?: string | null
          owner_id?: string | null
          owner_kind?: string | null
          previous_freshness?: string | null
          q_a_pair_id?: string | null
          review_cadence_days?: number | null
          source_document_id?: string | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          content_owner_id?: string | null
          created_at?: string | null
          domain?: string | null
          expiry_date?: string | null
          freshness?: string | null
          freshness_checked_at?: string | null
          governance_review_due?: string | null
          governance_review_status?: string | null
          governance_reviewer_id?: string | null
          id?: string | null
          lifecycle_type?: string | null
          next_review_date?: string | null
          owner_id?: string | null
          owner_kind?: string | null
          previous_freshness?: string | null
          q_a_pair_id?: string | null
          review_cadence_days?: number | null
          source_document_id?: string | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      reference_items: {
        Row: {
          body: string | null
          created_at: string | null
          id: string | null
          ingestion_source: string | null
          layer: string | null
          op_id: string | null
          primary_domain: string | null
          primary_subtopic: string | null
          published_at: string | null
          source_document_id: string | null
          source_url: string | null
          summary: string | null
          superseded_by: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          id?: string | null
          ingestion_source?: string | null
          layer?: string | null
          op_id?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          published_at?: string | null
          source_document_id?: string | null
          source_url?: string | null
          summary?: string | null
          superseded_by?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          id?: string | null
          ingestion_source?: string | null
          layer?: string | null
          op_id?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          published_at?: string | null
          source_document_id?: string | null
          source_url?: string | null
          summary?: string | null
          superseded_by?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      review_assignments: {
        Row: {
          assigned_by: string | null
          assignment_type: string | null
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          filter_content_types: string[] | null
          filter_date_from: string | null
          filter_date_to: string | null
          filter_domains: string[] | null
          filter_freshness: string[] | null
          id: string | null
          item_count: number | null
          notes: string | null
          reviewer_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_by?: string | null
          assignment_type?: string | null
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          filter_content_types?: string[] | null
          filter_date_from?: string | null
          filter_date_to?: string | null
          filter_domains?: string[] | null
          filter_freshness?: string[] | null
          id?: string | null
          item_count?: number | null
          notes?: string | null
          reviewer_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_by?: string | null
          assignment_type?: string | null
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          filter_content_types?: string[] | null
          filter_date_from?: string | null
          filter_date_to?: string | null
          filter_domains?: string[] | null
          filter_freshness?: string[] | null
          id?: string | null
          item_count?: number | null
          notes?: string | null
          reviewer_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      si_processing_queue: {
        Row: {
          articles_found: number | null
          articles_new: number | null
          articles_passed: number | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          feed_source_id: string | null
          id: string | null
          started_at: string | null
          status: string | null
          workspace_id: string | null
        }
        Insert: {
          articles_found?: number | null
          articles_new?: number | null
          articles_passed?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          feed_source_id?: string | null
          id?: string | null
          started_at?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Update: {
          articles_found?: number | null
          articles_new?: number | null
          articles_passed?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          feed_source_id?: string | null
          id?: string | null
          started_at?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      signup_policy: {
        Row: {
          allowed_domain: string | null
          id: boolean | null
        }
        Insert: {
          allowed_domain?: string | null
          id?: boolean | null
        }
        Update: {
          allowed_domain?: string | null
          id?: boolean | null
        }
        Relationships: []
      }
      source_documents: {
        Row: {
          admission_status: string | null
          ai_keywords: string[] | null
          archived_at: string | null
          archived_by: string | null
          auth: Json | null
          cadence: string | null
          captured_date: string | null
          classification_confidence: number | null
          classification_reasoning: string | null
          classified_at: string | null
          content_hash: string | null
          content_type: string | null
          created_at: string | null
          extracted_text: string | null
          extraction_metadata: Json | null
          extraction_method: string | null
          file_size: number | null
          filename: string | null
          id: string | null
          locator: string | null
          logical_path: string | null
          mime_type: string | null
          op_id: string | null
          origin_type: string | null
          original_filename: string | null
          parent_id: string | null
          pipeline_run_id: string | null
          primary_domain: string | null
          primary_subtopic: string | null
          publication_status: string | null
          retention_class: string | null
          secondary_domain: string | null
          secondary_subtopic: string | null
          source_url: string | null
          status: string | null
          storage_path: string | null
          suggested_title: string | null
          summary: string | null
          summary_data: Json | null
          updated_at: string | null
          updated_by: string | null
          uploaded_by: string | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          admission_status?: string | null
          ai_keywords?: string[] | null
          archived_at?: string | null
          archived_by?: string | null
          auth?: Json | null
          cadence?: string | null
          captured_date?: string | null
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classified_at?: string | null
          content_hash?: string | null
          content_type?: string | null
          created_at?: string | null
          extracted_text?: string | null
          extraction_metadata?: Json | null
          extraction_method?: string | null
          file_size?: number | null
          filename?: string | null
          id?: string | null
          locator?: string | null
          logical_path?: string | null
          mime_type?: string | null
          op_id?: string | null
          origin_type?: string | null
          original_filename?: string | null
          parent_id?: string | null
          pipeline_run_id?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          publication_status?: string | null
          retention_class?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_url?: string | null
          status?: string | null
          storage_path?: string | null
          suggested_title?: string | null
          summary?: string | null
          summary_data?: Json | null
          updated_at?: string | null
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          admission_status?: string | null
          ai_keywords?: string[] | null
          archived_at?: string | null
          archived_by?: string | null
          auth?: Json | null
          cadence?: string | null
          captured_date?: string | null
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classified_at?: string | null
          content_hash?: string | null
          content_type?: string | null
          created_at?: string | null
          extracted_text?: string | null
          extraction_metadata?: Json | null
          extraction_method?: string | null
          file_size?: number | null
          filename?: string | null
          id?: string | null
          locator?: string | null
          logical_path?: string | null
          mime_type?: string | null
          op_id?: string | null
          origin_type?: string | null
          original_filename?: string | null
          parent_id?: string | null
          pipeline_run_id?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          publication_status?: string | null
          retention_class?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_url?: string | null
          status?: string | null
          storage_path?: string | null
          suggested_title?: string | null
          summary?: string | null
          summary_data?: Json | null
          updated_at?: string | null
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      tag_morphology_drift_flags: {
        Row: {
          affected_content_ids: string[] | null
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          decision_rationale: string | null
          detected_at: string | null
          id: string | null
          proposed_canonical: string | null
          stored_tag: string | null
          usage_count: number | null
        }
        Insert: {
          affected_content_ids?: string[] | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_rationale?: string | null
          detected_at?: string | null
          id?: string | null
          proposed_canonical?: string | null
          stored_tag?: string | null
          usage_count?: number | null
        }
        Update: {
          affected_content_ids?: string[] | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_rationale?: string | null
          detected_at?: string | null
          id?: string | null
          proposed_canonical?: string | null
          stored_tag?: string | null
          usage_count?: number | null
        }
        Relationships: []
      }
      taxonomy_domains: {
        Row: {
          accepted_at: string | null
          colour: string | null
          created_at: string | null
          description: string | null
          display_name: string | null
          display_order: number | null
          id: string | null
          is_active: boolean | null
          key_signal: string | null
          name: string | null
          provenance: string | null
          recommended_at: string | null
          recommended_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          colour?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          display_order?: number | null
          id?: string | null
          is_active?: boolean | null
          key_signal?: string | null
          name?: string | null
          provenance?: string | null
          recommended_at?: string | null
          recommended_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          colour?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          display_order?: number | null
          id?: string | null
          is_active?: boolean | null
          key_signal?: string | null
          name?: string | null
          provenance?: string | null
          recommended_at?: string | null
          recommended_by?: string | null
        }
        Relationships: []
      }
      taxonomy_subtopics: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          description: string | null
          display_name: string | null
          display_order: number | null
          domain_id: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          provenance: string | null
          recommended_at: string | null
          recommended_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          display_order?: number | null
          domain_id?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          provenance?: string | null
          recommended_at?: string | null
          recommended_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string | null
          display_order?: number | null
          domain_id?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          provenance?: string | null
          recommended_at?: string | null
          recommended_by?: string | null
        }
        Relationships: []
      }
      taxonomy_sync_state: {
        Row: {
          created_at: string | null
          id: string | null
          last_sync_at: string | null
          last_sync_hash: string | null
          synced_by: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          last_sync_at?: string | null
          last_sync_hash?: string | null
          synced_by?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          last_sync_at?: string | null
          last_sync_hash?: string | null
          synced_by?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      template_completions: {
        Row: {
          created_at: string | null
          created_by: string | null
          fields_failed: number | null
          fields_filled: number | null
          fields_skipped: number | null
          file_size: number | null
          form_instance_id: string | null
          id: string | null
          job_id: string | null
          storage_path: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          fields_failed?: number | null
          fields_filled?: number | null
          fields_skipped?: number | null
          file_size?: number | null
          form_instance_id?: string | null
          id?: string | null
          job_id?: string | null
          storage_path?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          fields_failed?: number | null
          fields_filled?: number | null
          fields_skipped?: number | null
          file_size?: number | null
          form_instance_id?: string | null
          id?: string | null
          job_id?: string | null
          storage_path?: string | null
        }
        Relationships: []
      }
      tenant_config: {
        Row: {
          config: Json | null
          created_at: string | null
          id: boolean | null
          updated_at: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          id?: boolean | null
          updated_at?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          id?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_notification_prefs: {
        Row: {
          auto_generate_change_reports: boolean | null
          created_at: string | null
          email_owned_content_flagged: boolean | null
          email_review_assigned: boolean | null
          email_weekly_change_report: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          auto_generate_change_reports?: boolean | null
          created_at?: string | null
          email_owned_content_flagged?: boolean | null
          email_review_assigned?: boolean | null
          email_weekly_change_report?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          auto_generate_change_reports?: boolean | null
          created_at?: string | null
          email_owned_content_flagged?: boolean | null
          email_review_assigned?: boolean | null
          email_weekly_change_report?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          display_name: string | null
          granted_by: string | null
          id: string | null
          role: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          granted_by?: string | null
          id?: string | null
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          granted_by?: string | null
          id?: string | null
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      verification_history: {
        Row: {
          action_type: string | null
          id: string | null
          note: string | null
          owner_kind: string | null
          performed_at: string | null
          performed_by: string | null
          q_a_pair_id: string | null
          source_document_id: string | null
        }
        Insert: {
          action_type?: string | null
          id?: string | null
          note?: string | null
          owner_kind?: string | null
          performed_at?: string | null
          performed_by?: string | null
          q_a_pair_id?: string | null
          source_document_id?: string | null
        }
        Update: {
          action_type?: string | null
          id?: string | null
          note?: string | null
          owner_kind?: string | null
          performed_at?: string | null
          performed_by?: string | null
          q_a_pair_id?: string | null
          source_document_id?: string | null
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          application_type_id: string | null
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          domain_metadata: Json | null
          icon: string | null
          id: string | null
          is_archived: boolean | null
          name: string | null
          status: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          application_type_id?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          domain_metadata?: Json | null
          icon?: string | null
          id?: string | null
          is_archived?: boolean | null
          name?: string | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          application_type_id?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          domain_metadata?: Json | null
          icon?: string | null
          id?: string | null
          is_archived?: boolean | null
          name?: string | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _test_delete_broken_auth_user: {
        Args: { probe_id: string }
        Returns: undefined
      }
      _test_insert_broken_auth_user: {
        Args: { probe_email: string; probe_id: string }
        Returns: undefined
      }
      check_content_exists: {
        Args: { ids: string[] }
        Returns: {
          id: string
          item_exists: boolean
        }[]
      }
      citations_cascade_preflight: {
        Args: never
        Returns: {
          at_risk_citation_count: number
          safe_to_reprocess: boolean
        }[]
      }
      claim_next_job: {
        Args: never
        Returns: Database["api"]["Views"]["processing_queue"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "processing_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_filtered_articles: { Args: never; Returns: number }
      corpus_writer_fence_lease_acquire: {
        Args: {
          p_fence_name?: string
          p_holder?: string
          p_holder_token: string
          p_ttl_seconds?: number
        }
        Returns: boolean
      }
      corpus_writer_fence_lease_release: {
        Args: {
          p_fence_name?: string
          p_holder?: string
          p_holder_token: string
        }
        Returns: boolean
      }
      corpus_writer_fence_release: {
        Args: { p_holder?: string }
        Returns: boolean
      }
      corpus_writer_fence_try_acquire: {
        Args: { p_holder?: string }
        Returns: boolean
      }
      count_auth_users: { Args: never; Returns: number }
      get_aggregate_win_rate_stats: {
        Args: never
        Returns: {
          losing_citations: number
          pending_citations: number
          scope: string
          shortlist_pass_rate: number
          shortlist_passed: number
          shortlist_total: number
          total_citations: number
          unique_items_cited: number
          unique_procurements: number
          win_rate: number
          winning_citations: number
        }[]
      }
      get_content_owner_stats: {
        Args: never
        Returns: {
          aging_count: number
          expired_count: number
          fresh_count: number
          owner_id: string
          stale_count: number
          total_items: number
          unverified_count: number
        }[]
      }
      get_content_win_rate: {
        Args: { p_q_a_pair_id: string }
        Returns: {
          losing_citations: number
          pending_citations: number
          total_citations: number
          win_rate: number
          winning_citations: number
        }[]
      }
      get_dashboard_attention_counts: {
        Args: { p_role?: string; p_user_id: string }
        Returns: {
          expired_content_count: number
          expiring_content_date_count: number
          freshness_summary: Json
          governance_review_count: number
          quality_flag_count: number
          stale_content_count: number
          unread_notification_count: number
          unverified_count: number
        }[]
      }
      get_document_version_chain: {
        Args: { p_document_id: string }
        Returns: {
          content_hash: string
          content_item_count: number
          created_at: string
          file_size: number
          filename: string
          id: string
          mime_type: string
          original_filename: string
          parent_id: string
          status: string
          storage_path: string
          uploaded_by: string
          version: number
        }[]
      }
      get_due_feed_sources: {
        Args: { max_sources?: number }
        Returns: Database["api"]["Views"]["feed_sources"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "feed_sources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_entity_list_aggregated: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_type?: string
          p_type_conflicts?: boolean
          p_variants_only?: boolean
        }
        Returns: Json
      }
      get_entity_summary: {
        Args: {
          p_entity_name?: string
          p_entity_type?: string
          p_limit?: number
        }
        Returns: {
          canonical_name: string
          content_item_ids: string[]
          entity_type: string
          mention_count: number
          related_entities: Json
        }[]
      }
      get_filter_ratio_trend: {
        Args: {
          p_granularity?: string
          p_period_days?: number
          p_workspace_id: string
        }
        Returns: {
          date: string
          filtered: number
          passed: number
          ratio: number
          total: number
        }[]
      }
      get_form_question_stats: {
        Args: { p_project_id: string }
        Returns: {
          complete_count: number
          drafted_count: number
          needs_sme_count: number
          no_content_count: number
          partial_match_count: number
          strong_match_count: number
          total_questions: number
          unmatched_count: number
        }[]
      }
      get_form_question_stats_batch: {
        Args: { p_project_ids: string[] }
        Returns: {
          complete_count: number
          drafted_count: number
          needs_sme_count: number
          no_content_count: number
          partial_match_count: number
          strong_match_count: number
          total_questions: number
          unmatched_count: number
          workspace_id: string
        }[]
      }
      get_freshness_breakdown: {
        Args: never
        Returns: {
          count: number
          freshness: string
        }[]
      }
      get_guide_content: {
        Args: { p_guide_slug: string }
        Returns: {
          content_brief: string
          content_captured_date: string
          content_freshness: string
          content_id: string
          content_layer: string
          content_title: string
          content_type: string
          content_verified_at: string
          expected_layer: string
          is_required: boolean
          section_description: string
          section_id: string
          section_name: string
          section_order: number
          subtopic_filter: string
        }[]
      }
      get_popular_keywords: {
        Args: { p_limit?: number }
        Returns: {
          item_count: number
          keyword: string
        }[]
      }
      get_review_breakdown_stats: { Args: never; Returns: Json }
      get_user_display_names: {
        Args: { user_ids: string[] }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      hybrid_search: {
        Args: {
          application_type?: string
          filter_date_from?: string
          filter_date_to?: string
          filter_domain?: string
          filter_kind?: string
          filter_subtopic?: string
          include_superseded?: boolean
          limit_count?: number
          query_embedding: string
          query_text?: string
          similarity_threshold?: number
          visibility_filter?: string
        }
        Returns: {
          ai_keywords: string[]
          author_name: string
          captured_date: string
          classification_confidence: number
          content_type: string
          created_by: string
          id: string
          metadata: Json
          owner_kind: string
          platform: string
          primary_domain: string
          primary_subtopic: string
          priority: string
          scope_tag: string[]
          similarity: number
          snippet: string
          source_domain: string
          source_url: string
          suggested_title: string
          summary: string
          thumbnail_url: string
          title: string
          verified_at: string
          verified_by: string
        }[]
      }
      list_public_tables: { Args: never; Returns: string[] }
      merge_entities: {
        Args: {
          p_entity_type: string
          p_source_names: string[]
          p_target_name: string
        }
        Returns: {
          duplicates_removed: number
          entity_type: string
          mentions_updated: number
          merged: boolean
          relationship_sources_updated: number
          relationship_targets_updated: number
          target: string
        }[]
      }
      merge_item_metadata: {
        Args: { p_item_id: string; p_new_data: Json }
        Returns: undefined
      }
      q_a_extractions_promotion_candidates: {
        Args: never
        Returns: Database["api"]["Views"]["q_a_extractions"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "q_a_extractions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      q_a_get_verbatim: {
        Args: { p_pair_id: string }
        Returns: {
          alternate_question_phrasings: string[]
          answer_advanced: string
          answer_standard: string
          anti_scope_tag: string[]
          created_at: string
          id: string
          origin_kind: string
          publication_status: string
          question_text: string
          scope_tag: string[]
          superseded_by: string
          updated_at: string
          valid_from: string
          valid_to: string
        }[]
      }
      q_a_search: {
        Args: { p_limit?: number; p_query: string; p_query_embedding: string }
        Returns: {
          answer_standard_preview: string
          embedding_score: number
          fulltext_score: number
          pair_id: string
          publication_status: string
          question_text_preview: string
          scope_tag: string[]
        }[]
      }
      question_match_recompute: {
        Args: {
          p_anti_scope_tag: string[]
          p_form_question_id: string
          p_limit?: number
          p_query: string
          p_query_embedding: string
          p_question_kind: string
          p_scope_tag: string[]
        }
        Returns: number
      }
      question_match_search: {
        Args: {
          p_form_question_id: string
          p_limit?: number
          p_question_kind?: string
        }
        Returns: {
          answer_standard_preview: string
          embedding_score: number
          fulltext_score: number
          publication_status: string
          q_a_pair_id: string
          question_text_preview: string
          scope_tag: string[]
        }[]
      }
      reap_orphaned_source_documents: {
        Args: never
        Returns: {
          chunks_deleted: number
          embeddings_deleted: number
          entity_mentions_deleted: number
          entity_relationships_deleted: number
          extractions_deleted: number
          source_document_id: string
        }[]
      }
      reap_stuck_jobs: { Args: { p_timeout_seconds: number }; Returns: number }
      recalculate_all_freshness: {
        Args: never
        Returns: {
          aging_count: number
          expired_count: number
          fresh_count: number
          stale_count: number
          total_count: number
        }[]
      }
      reference_get_verbatim: {
        Args: { p_reference_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          ingestion_source: string
          layer: string
          op_id: string
          primary_domain: string
          primary_subtopic: string
          published_at: string
          source_document_id: string
          source_url: string
          summary: string
          title: string
          updated_at: string
        }[]
      }
      reference_ingest: {
        Args: {
          p_body: string
          p_content_hash: string
          p_embedding: string
          p_extraction_metadata?: Json
          p_file_size: number
          p_filename: string
          p_mime_type: string
          p_op_id?: string
          p_primary_domain: string
          p_primary_subtopic: string
          p_published_at: string
          p_source_url: string
          p_summary: string
          p_title: string
        }
        Returns: {
          already_existed: boolean
          primary_domain: string
          primary_subtopic: string
          reference_id: string
          source_document_id: string
          source_url: string
          summary: string
          title: string
        }[]
      }
      reference_list: {
        Args: {
          p_ingestion_source?: string
          p_limit?: number
          p_offset?: number
          p_primary_domain?: string
          p_primary_subtopic?: string
          p_published_from?: string
          p_published_to?: string
        }
        Returns: {
          body_preview: string
          ingestion_source: string
          layer: string
          primary_domain: string
          primary_subtopic: string
          published_at: string
          reference_id: string
          source_document_id: string
          source_url: string
          summary_preview: string
          title: string
        }[]
      }
      reference_search: {
        Args: { p_limit?: number; p_query: string; p_query_embedding: string }
        Returns: {
          body_preview: string
          embedding_score: number
          fulltext_score: number
          ingestion_source: string
          layer: string
          primary_domain: string
          primary_subtopic: string
          published_at: string
          reference_id: string
          source_document_id: string
          source_url: string
          summary_preview: string
          title: string
        }[]
      }
      resolve_or_mint_source_identity: {
        Args: {
          p_content_hash: string
          p_file_size: number
          p_filename: string
          p_mime_type: string
          p_op_id?: string
          p_origin_type?: string
          p_rel_path: string
          p_retention_class?: string
        }
        Returns: {
          source_document_id: string
          was_minted: boolean
        }[]
      }
      search_for_form_response: {
        Args: {
          include_superseded?: boolean
          limit_count?: number
          query_embedding: string
          query_text?: string
          visibility_filter?: string
        }
        Returns: {
          content: string
          content_type: string
          id: string
          similarity: number
          summary: string
          title: string
        }[]
      }
      set_config: {
        Args: { is_local: boolean; setting: string; value: string }
        Returns: string
      }
      tombstone_source_document: {
        Args: { p_id: string }
        Returns: {
          chunks_deleted: number
          embeddings_deleted: number
          entity_mentions_deleted: number
          entity_relationships_deleted: number
          extractions_deleted: number
          source_document_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  api: {
    Enums: {},
  },
} as const
