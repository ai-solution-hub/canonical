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
  public: {
    Tables: {
      ai_call_events: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number
          model: string
          outcome_signal: Database["public"]["Enums"]["outcome_signal"]
          output_tokens: number
          tier: string
          touchpoint_id: string
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model: string
          outcome_signal: Database["public"]["Enums"]["outcome_signal"]
          output_tokens?: number
          tier: string
          touchpoint_id: string
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string
          outcome_signal?: Database["public"]["Enums"]["outcome_signal"]
          output_tokens?: number
          tier?: string
          touchpoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_events_touchpoint_id_fkey"
            columns: ["touchpoint_id"]
            isOneToOne: false
            referencedRelation: "eval_touchpoints"
            referencedColumns: ["touchpoint_id"]
          },
        ]
      }
      application_types: {
        Row: {
          created_at: string
          default_colour: string | null
          default_icon: string | null
          description: string | null
          id: string
          key: string
          label: string
          label_plural: string | null
          provenance: string
          state_machine_config: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_colour?: string | null
          default_icon?: string | null
          description?: string | null
          id?: string
          key: string
          label: string
          label_plural?: string | null
          provenance?: string
          state_machine_config?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_colour?: string | null
          default_icon?: string | null
          description?: string | null
          id?: string
          key?: string
          label?: string
          label_plural?: string | null
          provenance?: string
          state_machine_config?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      change_reports: {
        Row: {
          created_at: string
          created_by: string | null
          domain_summaries: Json
          frequency: string
          generated_at: string
          generated_by: string
          id: string
          item_count: number
          item_ids: string[] | null
          metadata: Json | null
          narrative_summary: string | null
          period_end: string
          period_start: string
          tokens_used: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain_summaries?: Json
          frequency?: string
          generated_at?: string
          generated_by?: string
          id?: string
          item_count?: number
          item_ids?: string[] | null
          metadata?: Json | null
          narrative_summary?: string | null
          period_end: string
          period_start: string
          tokens_used?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain_summaries?: Json
          frequency?: string
          generated_at?: string
          generated_by?: string
          id?: string
          item_count?: number
          item_ids?: string[] | null
          metadata?: Json | null
          narrative_summary?: string | null
          period_end?: string
          period_start?: string
          tokens_used?: number | null
        }
        Relationships: []
      }
      citations: {
        Row: {
          citation_type: string
          cited_concept_path: string | null
          cited_end: number | null
          cited_kind: Database["public"]["Enums"]["cited_target_kind"]
          cited_location_kind: string | null
          cited_q_a_pair_id: string | null
          cited_q_a_pair_version: number | null
          cited_reference_item_id: string | null
          cited_source_document_id: string | null
          cited_start: number | null
          cited_text: string | null
          cited_version: number | null
          citing_form_response_id: string | null
          citing_kind: Database["public"]["Enums"]["citing_entity_kind"]
          created_at: string
          created_by: string | null
          id: string
        }
        Insert: {
          citation_type?: string
          cited_concept_path?: string | null
          cited_end?: number | null
          cited_kind: Database["public"]["Enums"]["cited_target_kind"]
          cited_location_kind?: string | null
          cited_q_a_pair_id?: string | null
          cited_q_a_pair_version?: number | null
          cited_reference_item_id?: string | null
          cited_source_document_id?: string | null
          cited_start?: number | null
          cited_text?: string | null
          cited_version?: number | null
          citing_form_response_id?: string | null
          citing_kind?: Database["public"]["Enums"]["citing_entity_kind"]
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Update: {
          citation_type?: string
          cited_concept_path?: string | null
          cited_end?: number | null
          cited_kind?: Database["public"]["Enums"]["cited_target_kind"]
          cited_location_kind?: string | null
          cited_q_a_pair_id?: string | null
          cited_q_a_pair_version?: number | null
          cited_reference_item_id?: string | null
          cited_source_document_id?: string | null
          cited_start?: number | null
          cited_text?: string | null
          cited_version?: number | null
          citing_form_response_id?: string | null
          citing_kind?: Database["public"]["Enums"]["citing_entity_kind"]
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "citations_cited_q_a_pair_id_fkey"
            columns: ["cited_q_a_pair_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_cited_reference_item_id_fkey"
            columns: ["cited_reference_item_id"]
            isOneToOne: false
            referencedRelation: "reference_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_cited_source_document_id_fkey"
            columns: ["cited_source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_citing_form_response_id_fkey"
            columns: ["citing_form_response_id"]
            isOneToOne: false
            referencedRelation: "form_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_disputes: {
        Row: {
          created_at: string
          current_value: Json
          disputed_by: string | null
          disputed_field: string
          id: string
          proposed_value: Json | null
          rationale: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_document_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_value?: Json
          disputed_by?: string | null
          disputed_field: string
          id?: string
          proposed_value?: Json | null
          rationale: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_document_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_value?: Json
          disputed_by?: string | null
          disputed_field?: string
          id?: string
          proposed_value?: Json | null
          rationale?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_document_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classification_disputes_disputed_by_fkey"
            columns: ["disputed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_disputes_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          certifications: string[]
          competitors: Json
          created_at: string
          created_by: string | null
          description: string | null
          geographic_scope: string[]
          id: string
          is_active: boolean
          is_primary: boolean
          key_topics: string[]
          name: string
          sectors: string[]
          services: string[]
          slug: string
          target_customers: string | null
          updated_at: string
          value_proposition: string | null
          website_url: string | null
        }
        Insert: {
          certifications?: string[]
          competitors?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          geographic_scope?: string[]
          id?: string
          is_active?: boolean
          is_primary?: boolean
          key_topics?: string[]
          name: string
          sectors?: string[]
          services?: string[]
          slug: string
          target_customers?: string | null
          updated_at?: string
          value_proposition?: string | null
          website_url?: string | null
        }
        Update: {
          certifications?: string[]
          competitors?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          geographic_scope?: string[]
          id?: string
          is_active?: boolean
          is_primary?: boolean
          key_topics?: string[]
          name?: string
          sectors?: string[]
          services?: string[]
          slug?: string
          target_customers?: string | null
          updated_at?: string
          value_proposition?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_research_workspaces: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_research_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_chunks: {
        Row: {
          char_count: number
          content: string
          created_at: string
          heading_level: number | null
          heading_path: string[]
          heading_text: string | null
          id: string
          op_id: string | null
          parent_chunk_id: string | null
          position: number
          source_document_id: string
          updated_at: string
          word_count: number
        }
        Insert: {
          char_count?: number
          content: string
          created_at?: string
          heading_level?: number | null
          heading_path?: string[]
          heading_text?: string | null
          id?: string
          op_id?: string | null
          parent_chunk_id?: string | null
          position: number
          source_document_id: string
          updated_at?: string
          word_count?: number
        }
        Update: {
          char_count?: number
          content?: string
          created_at?: string
          heading_level?: number | null
          heading_path?: string[]
          heading_text?: string | null
          id?: string
          op_id?: string | null
          parent_chunk_id?: string | null
          position?: number
          source_document_id?: string
          updated_at?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_chunks_parent_chunk_id_fkey"
            columns: ["parent_chunk_id"]
            isOneToOne: false
            referencedRelation: "content_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_chunks_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      content_propagation_version: {
        Row: {
          applied_at: string
          payload_checksum: string
          payload_key: string
          version: number
        }
        Insert: {
          applied_at?: string
          payload_checksum: string
          payload_key: string
          version: number
        }
        Update: {
          applied_at?: string
          payload_checksum?: string
          payload_key?: string
          version?: number
        }
        Relationships: []
      }
      corpus_writer_fence_lease: {
        Row: {
          acquired_at: string
          expires_at: string
          fence_name: string
          holder_label: string | null
          holder_token: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          fence_name: string
          holder_label?: string | null
          holder_token: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          fence_name?: string
          holder_label?: string | null
          holder_token?: string
        }
        Relationships: []
      }
      coverage_targets: {
        Row: {
          created_at: string | null
          created_by: string | null
          domain_id: string
          id: string
          metric_name: string
          target_value: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          domain_id: string
          id?: string
          metric_name: string
          target_value: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          domain_id?: string
          id?: string
          metric_name?: string
          target_value?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_targets_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_targets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_group_content: {
        Row: {
          created_at: string
          engagement_group_id: string
          id: string
          q_a_pair_id: string
        }
        Insert: {
          created_at?: string
          engagement_group_id: string
          id?: string
          q_a_pair_id: string
        }
        Update: {
          created_at?: string
          engagement_group_id?: string
          id?: string
          q_a_pair_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_group_content_engagement_group_id_fkey"
            columns: ["engagement_group_id"]
            isOneToOne: false
            referencedRelation: "engagement_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_group_content_q_a_pair_id_fkey"
            columns: ["q_a_pair_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_groups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_aliases: {
        Row: {
          alias: string
          canonical: string
          created_at: string
          id: string
          is_active: boolean
          provenance: string
        }
        Insert: {
          alias: string
          canonical: string
          created_at?: string
          id?: string
          is_active?: boolean
          provenance?: string
        }
        Update: {
          alias?: string
          canonical?: string
          created_at?: string
          id?: string
          is_active?: boolean
          provenance?: string
        }
        Relationships: []
      }
      entity_mentions: {
        Row: {
          canonical_name: string
          confidence: number | null
          context_snippet: string | null
          created_at: string | null
          entity_name: string
          entity_type: string
          entity_type_override: string | null
          id: string
          metadata: Json | null
          normalisation_version: number | null
          op_id: string | null
          source_document_id: string
          updated_at: string
        }
        Insert: {
          canonical_name: string
          confidence?: number | null
          context_snippet?: string | null
          created_at?: string | null
          entity_name: string
          entity_type: string
          entity_type_override?: string | null
          id?: string
          metadata?: Json | null
          normalisation_version?: number | null
          op_id?: string | null
          source_document_id: string
          updated_at?: string
        }
        Update: {
          canonical_name?: string
          confidence?: number | null
          context_snippet?: string | null
          created_at?: string | null
          entity_name?: string
          entity_type?: string
          entity_type_override?: string | null
          id?: string
          metadata?: Json | null
          normalisation_version?: number | null
          op_id?: string | null
          source_document_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_mentions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_pair_resolutions: {
        Row: {
          decision: string
          entity_type: string
          id: string
          name_a: string
          name_b: string
          op_id: string | null
          resolved_at: string
        }
        Insert: {
          decision: string
          entity_type: string
          id?: string
          name_a: string
          name_b: string
          op_id?: string | null
          resolved_at?: string
        }
        Update: {
          decision?: string
          entity_type?: string
          id?: string
          name_a?: string
          name_b?: string
          op_id?: string | null
          resolved_at?: string
        }
        Relationships: []
      }
      entity_relationships: {
        Row: {
          confidence: number | null
          created_at: string | null
          id: string
          relationship_type: string
          source_document_id: string | null
          source_entity: string
          target_entity: string
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          id?: string
          relationship_type: string
          source_document_id?: string | null
          source_entity: string
          target_entity: string
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          id?: string
          relationship_type?: string
          source_document_id?: string | null
          source_entity?: string
          target_entity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_baseline_audit: {
        Row: {
          action: string
          actor: string
          at: string
          id: string
          registry_version: number
          touchpoint_id: string
        }
        Insert: {
          action: string
          actor: string
          at?: string
          id?: string
          registry_version: number
          touchpoint_id: string
        }
        Update: {
          action?: string
          actor?: string
          at?: string
          id?: string
          registry_version?: number
          touchpoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_baseline_audit_touchpoint_id_fkey"
            columns: ["touchpoint_id"]
            isOneToOne: false
            referencedRelation: "eval_touchpoints"
            referencedColumns: ["touchpoint_id"]
          },
        ]
      }
      eval_baselines: {
        Row: {
          id: string
          metrics: Json
          promoted_at: string
          promoted_by: string
          registry_version: number
          thresholds: Json
          touchpoint_id: string
        }
        Insert: {
          id?: string
          metrics?: Json
          promoted_at?: string
          promoted_by: string
          registry_version: number
          thresholds?: Json
          touchpoint_id: string
        }
        Update: {
          id?: string
          metrics?: Json
          promoted_at?: string
          promoted_by?: string
          registry_version?: number
          thresholds?: Json
          touchpoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_baselines_touchpoint_id_fkey"
            columns: ["touchpoint_id"]
            isOneToOne: false
            referencedRelation: "eval_touchpoints"
            referencedColumns: ["touchpoint_id"]
          },
        ]
      }
      eval_runs: {
        Row: {
          exit_class: number
          id: string
          metrics: Json
          passed: boolean
          run_at: string
          severity_disposition: string
          source: string
          touchpoint_id: string
        }
        Insert: {
          exit_class: number
          id?: string
          metrics?: Json
          passed: boolean
          run_at?: string
          severity_disposition: string
          source: string
          touchpoint_id: string
        }
        Update: {
          exit_class?: number
          id?: string
          metrics?: Json
          passed?: boolean
          run_at?: string
          severity_disposition?: string
          source?: string
          touchpoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_runs_touchpoint_id_fkey"
            columns: ["touchpoint_id"]
            isOneToOne: false
            referencedRelation: "eval_touchpoints"
            referencedColumns: ["touchpoint_id"]
          },
        ]
      }
      eval_touchpoints: {
        Row: {
          contract_version: number
          created_at: string
          file_sha256: string | null
          graduation_metric: string | null
          grounding_shape: string
          kind: string
          owner: string
          registry_version: number
          severity_on_fail: string
          suite_name: string
          touchpoint_id: string
          updated_at: string
          variance_band: number
        }
        Insert: {
          contract_version?: number
          created_at?: string
          file_sha256?: string | null
          graduation_metric?: string | null
          grounding_shape: string
          kind: string
          owner: string
          registry_version?: number
          severity_on_fail: string
          suite_name: string
          touchpoint_id: string
          updated_at?: string
          variance_band?: number
        }
        Update: {
          contract_version?: number
          created_at?: string
          file_sha256?: string | null
          graduation_metric?: string | null
          grounding_shape?: string
          kind?: string
          owner?: string
          registry_version?: number
          severity_on_fail?: string
          suite_name?: string
          touchpoint_id?: string
          updated_at?: string
          variance_band?: number
        }
        Relationships: []
      }
      feed_articles: {
        Row: {
          ai_summary: string | null
          created_at: string
          external_id: string | null
          external_url: string
          extraction_method: string | null
          feed_source_id: string
          id: string
          ingested_at: string
          matched_categories: string[] | null
          passed: boolean
          prompt_version_id: string | null
          published_at: string | null
          raw_content: string | null
          reference_item_id: string | null
          relevance_category: string | null
          relevance_reasoning: string | null
          relevance_score: number | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          external_id?: string | null
          external_url: string
          extraction_method?: string | null
          feed_source_id: string
          id?: string
          ingested_at?: string
          matched_categories?: string[] | null
          passed?: boolean
          prompt_version_id?: string | null
          published_at?: string | null
          raw_content?: string | null
          reference_item_id?: string | null
          relevance_category?: string | null
          relevance_reasoning?: string | null
          relevance_score?: number | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          external_id?: string | null
          external_url?: string
          extraction_method?: string | null
          feed_source_id?: string
          id?: string
          ingested_at?: string
          matched_categories?: string[] | null
          passed?: boolean
          prompt_version_id?: string | null
          published_at?: string | null
          raw_content?: string | null
          reference_item_id?: string | null
          relevance_category?: string | null
          relevance_reasoning?: string | null
          relevance_score?: number | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_articles_feed_source_id_fkey"
            columns: ["feed_source_id"]
            isOneToOne: false
            referencedRelation: "feed_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_articles_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "feed_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_articles_reference_item_id_fkey"
            columns: ["reference_item_id"]
            isOneToOne: false
            referencedRelation: "reference_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_articles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_flags: {
        Row: {
          created_at: string
          feed_article_id: string
          flag_type: string
          flagged_by: string
          id: string
          notes: string | null
          prompt_version_id: string | null
          resolution_type: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          resolved_notes: string | null
        }
        Insert: {
          created_at?: string
          feed_article_id: string
          flag_type: string
          flagged_by: string
          id?: string
          notes?: string | null
          prompt_version_id?: string | null
          resolution_type?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_notes?: string | null
        }
        Update: {
          created_at?: string
          feed_article_id?: string
          flag_type?: string
          flagged_by?: string
          id?: string
          notes?: string | null
          prompt_version_id?: string | null
          resolution_type?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feed_flags_feed_article_id_fkey"
            columns: ["feed_article_id"]
            isOneToOne: false
            referencedRelation: "feed_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_flags_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_flags_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "feed_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_flags_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_prompts: {
        Row: {
          change_notes: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          performance_snapshot: Json | null
          prompt_text: string
          version: number
          workspace_id: string
        }
        Insert: {
          change_notes?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          performance_snapshot?: Json | null
          prompt_text: string
          version: number
          workspace_id: string
        }
        Update: {
          change_notes?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          performance_snapshot?: Json | null
          prompt_text?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_prompts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_prompts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_sources: {
        Row: {
          article_count: number
          consecutive_failures: number
          created_at: string
          created_by: string | null
          etag: string | null
          id: string
          is_active: boolean
          last_modified: string | null
          last_polled_at: string | null
          last_polled_error: string | null
          last_polled_status: string | null
          name: string
          polling_interval_minutes: number
          source_type: string
          updated_at: string
          url: string
          workspace_id: string
        }
        Insert: {
          article_count?: number
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          etag?: string | null
          id?: string
          is_active?: boolean
          last_modified?: string | null
          last_polled_at?: string | null
          last_polled_error?: string | null
          last_polled_status?: string | null
          name: string
          polling_interval_minutes?: number
          source_type?: string
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          article_count?: number
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          etag?: string | null
          id?: string
          is_active?: boolean
          last_modified?: string | null
          last_polled_at?: string | null
          last_polled_error?: string | null
          last_polled_status?: string | null
          name?: string
          polling_interval_minutes?: number
          source_type?: string
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      form_attachments: {
        Row: {
          created_at: string
          created_by: string | null
          engagement_group_id: string | null
          file_size: number | null
          filename: string
          form_instance_id: string | null
          id: string
          mime_type: string | null
          role: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          engagement_group_id?: string | null
          file_size?: number | null
          filename: string
          form_instance_id?: string | null
          id?: string
          mime_type?: string | null
          role: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          engagement_group_id?: string | null
          file_size?: number | null
          filename?: string
          form_instance_id?: string | null
          id?: string
          mime_type?: string | null
          role?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_attachments_engagement_group_id_fkey"
            columns: ["engagement_group_id"]
            isOneToOne: false
            referencedRelation: "engagement_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_attachments_form_instance_id_fkey"
            columns: ["form_instance_id"]
            isOneToOne: false
            referencedRelation: "form_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      form_instance_fields: {
        Row: {
          col_index: number | null
          created_at: string | null
          field_type: string
          fill_error: string | null
          fill_status: string
          form_instance_id: string
          geometry: Json | null
          id: string
          is_mandatory: boolean | null
          mapping_confidence: number | null
          mapping_status: string
          placeholder_text: string | null
          question_id: string | null
          question_text: string | null
          reference_urls: string[] | null
          row_index: number | null
          section_name: string | null
          sequence: number
          table_index: number | null
          updated_at: string | null
          word_limit: number | null
        }
        Insert: {
          col_index?: number | null
          created_at?: string | null
          field_type: string
          fill_error?: string | null
          fill_status?: string
          form_instance_id: string
          geometry?: Json | null
          id?: string
          is_mandatory?: boolean | null
          mapping_confidence?: number | null
          mapping_status?: string
          placeholder_text?: string | null
          question_id?: string | null
          question_text?: string | null
          reference_urls?: string[] | null
          row_index?: number | null
          section_name?: string | null
          sequence?: number
          table_index?: number | null
          updated_at?: string | null
          word_limit?: number | null
        }
        Update: {
          col_index?: number | null
          created_at?: string | null
          field_type?: string
          fill_error?: string | null
          fill_status?: string
          form_instance_id?: string
          geometry?: Json | null
          id?: string
          is_mandatory?: boolean | null
          mapping_confidence?: number | null
          mapping_status?: string
          placeholder_text?: string | null
          question_id?: string | null
          question_text?: string | null
          reference_urls?: string[] | null
          row_index?: number | null
          section_name?: string | null
          sequence?: number
          table_index?: number | null
          updated_at?: string | null
          word_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "form_instance_fields_form_instance_id_fkey"
            columns: ["form_instance_id"]
            isOneToOne: false
            referencedRelation: "form_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_template_fields_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "form_questions"
            referencedColumns: ["id"]
          },
        ]
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
          file_size: number
          filename: string
          form_type: string | null
          id: string
          ingest_source: string
          issuing_organisation: string | null
          mapped_count: number | null
          mime_type: string
          name: string
          outcome: string | null
          outcome_notes: string | null
          outcome_recorded_at: string | null
          outcome_recorded_by: string | null
          processing_status: string
          reference_number: string | null
          status_reason: string | null
          storage_path: string
          structure_path: string | null
          submission_date: string | null
          updated_at: string | null
          workflow_state: string
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
          file_size: number
          filename: string
          form_type?: string | null
          id?: string
          ingest_source: string
          issuing_organisation?: string | null
          mapped_count?: number | null
          mime_type: string
          name: string
          outcome?: string | null
          outcome_notes?: string | null
          outcome_recorded_at?: string | null
          outcome_recorded_by?: string | null
          processing_status?: string
          reference_number?: string | null
          status_reason?: string | null
          storage_path: string
          structure_path?: string | null
          submission_date?: string | null
          updated_at?: string | null
          workflow_state?: string
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
          file_size?: number
          filename?: string
          form_type?: string | null
          id?: string
          ingest_source?: string
          issuing_organisation?: string | null
          mapped_count?: number | null
          mime_type?: string
          name?: string
          outcome?: string | null
          outcome_notes?: string | null
          outcome_recorded_at?: string | null
          outcome_recorded_by?: string | null
          processing_status?: string
          reference_number?: string | null
          status_reason?: string | null
          storage_path?: string
          structure_path?: string | null
          submission_date?: string | null
          updated_at?: string | null
          workflow_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_instances_engagement_group_id_fkey"
            columns: ["engagement_group_id"]
            isOneToOne: false
            referencedRelation: "engagement_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_form_type_fkey"
            columns: ["form_type"]
            isOneToOne: false
            referencedRelation: "form_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "form_templates_outcome_fkey"
            columns: ["outcome"]
            isOneToOne: false
            referencedRelation: "form_outcome_types"
            referencedColumns: ["key"]
          },
        ]
      }
      form_outcome_types: {
        Row: {
          applicable_form_types: string[]
          counts_toward_win_rate: boolean
          key: string
          label: string
          provenance: string
          stage: string
        }
        Insert: {
          applicable_form_types?: string[]
          counts_toward_win_rate?: boolean
          key: string
          label: string
          provenance?: string
          stage: string
        }
        Update: {
          applicable_form_types?: string[]
          counts_toward_win_rate?: boolean
          key?: string
          label?: string
          provenance?: string
          stage?: string
        }
        Relationships: []
      }
      form_questions: {
        Row: {
          assigned_to: string | null
          confidence_posture: string | null
          created_at: string
          created_by: string | null
          evaluation_weight: number | null
          form_instance_id: string
          has_variants: boolean | null
          id: string
          question_sequence: number
          question_text: string
          section_name: string | null
          section_sequence: number
          status: string
          template_requirement_id: string | null
          updated_at: string | null
          word_limit: number | null
        }
        Insert: {
          assigned_to?: string | null
          confidence_posture?: string | null
          created_at?: string
          created_by?: string | null
          evaluation_weight?: number | null
          form_instance_id: string
          has_variants?: boolean | null
          id?: string
          question_sequence: number
          question_text: string
          section_name?: string | null
          section_sequence: number
          status?: string
          template_requirement_id?: string | null
          updated_at?: string | null
          word_limit?: number | null
        }
        Update: {
          assigned_to?: string | null
          confidence_posture?: string | null
          created_at?: string
          created_by?: string | null
          evaluation_weight?: number | null
          form_instance_id?: string
          has_variants?: boolean | null
          id?: string
          question_sequence?: number
          question_text?: string
          section_name?: string | null
          section_sequence?: number
          status?: string
          template_requirement_id?: string | null
          updated_at?: string | null
          word_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "form_questions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_questions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_questions_form_template_id_fkey"
            columns: ["form_instance_id"]
            isOneToOne: false
            referencedRelation: "form_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_questions_template_requirement_id_fkey"
            columns: ["template_requirement_id"]
            isOneToOne: false
            referencedRelation: "form_requirement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_requirement_templates: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number
          id: string
          is_current: boolean | null
          is_mandatory: boolean | null
          matching_guidance: string | null
          matching_keywords: string[] | null
          primary_domain: string | null
          primary_subtopic: string | null
          question_number: number | null
          requirement_text: string
          requirement_type: string
          secondary_domain: string | null
          secondary_subtopic: string | null
          section_name: string
          section_ref: string
          sector_applicability: string[] | null
          template_name: string
          template_type: string
          template_version: string | null
          updated_at: string | null
          word_limit_guidance: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_current?: boolean | null
          is_mandatory?: boolean | null
          matching_guidance?: string | null
          matching_keywords?: string[] | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          question_number?: number | null
          requirement_text: string
          requirement_type: string
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          section_name: string
          section_ref: string
          sector_applicability?: string[] | null
          template_name: string
          template_type: string
          template_version?: string | null
          updated_at?: string | null
          word_limit_guidance?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_current?: boolean | null
          is_mandatory?: boolean | null
          matching_guidance?: string | null
          matching_keywords?: string[] | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          question_number?: number | null
          requirement_text?: string
          requirement_type?: string
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          section_name?: string
          section_ref?: string
          sector_applicability?: string[] | null
          template_name?: string
          template_type?: string
          template_version?: string | null
          updated_at?: string | null
          word_limit_guidance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "form_template_requirements_template_type_fkey"
            columns: ["template_type"]
            isOneToOne: false
            referencedRelation: "form_types"
            referencedColumns: ["key"]
          },
        ]
      }
      form_response_history: {
        Row: {
          change_reason: string | null
          created_at: string
          edited_by: string | null
          id: string
          metadata: Json | null
          response_id: string
          response_text: string | null
          response_text_advanced: string | null
          review_status: string
          source_record_ids: string[] | null
          version: number
        }
        Insert: {
          change_reason?: string | null
          created_at?: string
          edited_by?: string | null
          id?: string
          metadata?: Json | null
          response_id: string
          response_text?: string | null
          response_text_advanced?: string | null
          review_status: string
          source_record_ids?: string[] | null
          version: number
        }
        Update: {
          change_reason?: string | null
          created_at?: string
          edited_by?: string | null
          id?: string
          metadata?: Json | null
          response_id?: string
          response_text?: string | null
          response_text_advanced?: string | null
          review_status?: string
          source_record_ids?: string[] | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_response_history_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_response_history_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "form_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      form_responses: {
        Row: {
          approved_by: string | null
          created_at: string
          drafted_by: string | null
          id: string
          last_edited_by: string | null
          metadata: Json | null
          overall_score: number | null
          question_id: string
          response_text: string | null
          response_text_advanced: string | null
          review_status: string
          source_record_ids: string[] | null
          updated_at: string | null
          version: number
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          drafted_by?: string | null
          id?: string
          last_edited_by?: string | null
          metadata?: Json | null
          overall_score?: number | null
          question_id: string
          response_text?: string | null
          response_text_advanced?: string | null
          review_status?: string
          source_record_ids?: string[] | null
          updated_at?: string | null
          version?: number
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          drafted_by?: string | null
          id?: string
          last_edited_by?: string | null
          metadata?: Json | null
          overall_score?: number | null
          question_id?: string
          response_text?: string | null
          response_text_advanced?: string | null
          review_status?: string
          source_record_ids?: string[] | null
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_responses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_responses_drafted_by_fkey"
            columns: ["drafted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_responses_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "form_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_types: {
        Row: {
          applicable_application_types: string[]
          created_at: string
          key: string
          label: string
          provenance: string
        }
        Insert: {
          applicable_application_types?: string[]
          created_at?: string
          key: string
          label: string
          provenance?: string
        }
        Update: {
          applicable_application_types?: string[]
          created_at?: string
          key?: string
          label?: string
          provenance?: string
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
          domain: string
          id: string
          posture: string
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
          domain: string
          id?: string
          posture?: string
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
          domain?: string
          id?: string
          posture?: string
          preset?: string | null
          quality_score_threshold?: number | null
          reviewer_id?: string | null
          timeout_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governance_config_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_config_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_sections: {
        Row: {
          content_type_filter: string | null
          created_at: string
          description: string | null
          display_order: number
          expected_layer: string | null
          guide_id: string
          id: string
          is_required: boolean
          parent_section_id: string | null
          section_name: string
          subtopic_filter: string | null
          updated_at: string
        }
        Insert: {
          content_type_filter?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          expected_layer?: string | null
          guide_id: string
          id?: string
          is_required?: boolean
          parent_section_id?: string | null
          section_name: string
          subtopic_filter?: string | null
          updated_at?: string
        }
        Update: {
          content_type_filter?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          expected_layer?: string | null
          guide_id?: string
          id?: string
          is_required?: boolean
          parent_section_id?: string | null
          section_name?: string
          subtopic_filter?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guide_sections_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guide_sections_parent_section_id_fkey"
            columns: ["parent_section_id"]
            isOneToOne: false
            referencedRelation: "guide_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      guides: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          domain_filter: string | null
          guide_type: string
          icon: string | null
          id: string
          is_published: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          domain_filter?: string | null
          guide_type?: string
          icon?: string | null
          id?: string
          is_published?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          domain_filter?: string | null
          guide_type?: string
          icon?: string | null
          id?: string
          is_published?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_quality_log: {
        Row: {
          created_at: string | null
          created_by: string | null
          details: Json | null
          flag_type: string
          id: string
          ingestion_batch: string | null
          resolution_notes: string | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_document_id: string | null
          source_url: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          flag_type: string
          id?: string
          ingestion_batch?: string | null
          resolution_notes?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_document_id?: string | null
          source_url?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          flag_type?: string
          id?: string
          ingestion_batch?: string | null
          resolution_notes?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_document_id?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_quality_log_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      intelligence_workspaces: {
        Row: {
          company_profile_id: string | null
          created_at: string
          guide_id: string | null
          id: string
          relevance_threshold: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_profile_id?: string | null
          created_at?: string
          guide_id?: string | null
          id?: string
          relevance_threshold?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_profile_id?: string | null
          created_at?: string
          guide_id?: string | null
          id?: string
          relevance_threshold?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intelligence_workspaces_company_profile_id_fkey"
            columns: ["company_profile_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intelligence_workspaces_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intelligence_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      layer_vocabulary: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          key: string
          label: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          key: string
          label: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          dismissed_at: string | null
          entity_id: string
          entity_type: string
          expires_at: string | null
          id: string
          message: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          dismissed_at?: string | null
          entity_id: string
          entity_type: string
          expires_at?: string | null
          id?: string
          message?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          dismissed_at?: string | null
          entity_id?: string
          entity_type?: string
          expires_at?: string | null
          id?: string
          message?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          completed_at: string | null
          cost: number | null
          created_at: string
          created_by: string | null
          ended_at: string | null
          error_message: string | null
          id: string
          items_created: string[] | null
          items_processed: number | null
          items_skipped: number | null
          items_updated: number | null
          op_id: string | null
          pipeline_name: string
          progress: Json | null
          result: Json | null
          source_filename: string | null
          started_at: string
          status: string
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          error_message?: string | null
          id?: string
          items_created?: string[] | null
          items_processed?: number | null
          items_skipped?: number | null
          items_updated?: number | null
          op_id?: string | null
          pipeline_name: string
          progress?: Json | null
          result?: Json | null
          source_filename?: string | null
          started_at?: string
          status?: string
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          error_message?: string | null
          id?: string
          items_created?: string[] | null
          items_processed?: number | null
          items_skipped?: number | null
          items_updated?: number | null
          op_id?: string | null
          pipeline_name?: string
          progress?: Json | null
          result?: Json | null
          source_filename?: string | null
          started_at?: string
          status?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          max_attempts: number
          payload: Json
          priority: number
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_guide_workspaces: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_guide_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_dispositions: {
        Row: {
          action: string
          actor: string
          created_at: string
          extraction_id: string
          id: string
          proposed_snapshot: Json
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          extraction_id: string
          id?: string
          proposed_snapshot: Json
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          extraction_id?: string
          id?: string
          proposed_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "promotion_dispositions_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "q_a_extractions"
            referencedColumns: ["id"]
          },
        ]
      }
      q_a_extractions: {
        Row: {
          alternate_question_phrasings: string[]
          created_at: string
          evaluation_criteria: string | null
          evidence_requirements: string[]
          expected_response_kind: string | null
          extracted_answer_text: string | null
          extracted_question_text: string
          extraction_metadata: Json
          extractor_kind: string
          id: string
          invalidated_at: string | null
          op_id: string | null
          promoted_to_pair_id: string | null
          scope_tags: string[]
          source_document_id: string | null
          updated_at: string
        }
        Insert: {
          alternate_question_phrasings?: string[]
          created_at?: string
          evaluation_criteria?: string | null
          evidence_requirements?: string[]
          expected_response_kind?: string | null
          extracted_answer_text?: string | null
          extracted_question_text: string
          extraction_metadata?: Json
          extractor_kind: string
          id?: string
          invalidated_at?: string | null
          op_id?: string | null
          promoted_to_pair_id?: string | null
          scope_tags?: string[]
          source_document_id?: string | null
          updated_at?: string
        }
        Update: {
          alternate_question_phrasings?: string[]
          created_at?: string
          evaluation_criteria?: string | null
          evidence_requirements?: string[]
          expected_response_kind?: string | null
          extracted_answer_text?: string | null
          extracted_question_text?: string
          extraction_metadata?: Json
          extractor_kind?: string
          id?: string
          invalidated_at?: string | null
          op_id?: string | null
          promoted_to_pair_id?: string | null
          scope_tags?: string[]
          source_document_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "q_a_extractions_promoted_to_pair_id_fkey"
            columns: ["promoted_to_pair_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "q_a_extractions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      q_a_pair_dedup_proposals: {
        Row: {
          created_at: string
          id: string
          pair_a_fingerprint: string | null
          pair_a_id: string
          pair_a_source_form_response_id: string | null
          pair_b_fingerprint: string | null
          pair_b_id: string
          pair_b_source_form_response_id: string | null
          proposed_survivor_id: string
          resolved_at: string | null
          resolved_by: string | null
          resolved_survivor_id: string | null
          similarity_score: number
          status: string
          survivor_reason: string
        }
        Insert: {
          created_at?: string
          id?: string
          pair_a_fingerprint?: string | null
          pair_a_id: string
          pair_a_source_form_response_id?: string | null
          pair_b_fingerprint?: string | null
          pair_b_id: string
          pair_b_source_form_response_id?: string | null
          proposed_survivor_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_survivor_id?: string | null
          similarity_score: number
          status?: string
          survivor_reason: string
        }
        Update: {
          created_at?: string
          id?: string
          pair_a_fingerprint?: string | null
          pair_a_id?: string
          pair_a_source_form_response_id?: string | null
          pair_b_fingerprint?: string | null
          pair_b_id?: string
          pair_b_source_form_response_id?: string | null
          proposed_survivor_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_survivor_id?: string | null
          similarity_score?: number
          status?: string
          survivor_reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "q_a_pair_dedup_proposals_pair_a_id_fkey"
            columns: ["pair_a_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "q_a_pair_dedup_proposals_pair_b_id_fkey"
            columns: ["pair_b_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
        ]
      }
      q_a_pair_history: {
        Row: {
          alternate_question_phrasings: string[]
          answer_advanced: string | null
          answer_standard: string
          anti_scope_tag: string[]
          changed_at: string
          changed_by: string | null
          edit_intent: string | null
          id: string
          origin_kind: string
          publication_status: string
          q_a_pair_id: string
          question_text: string
          scope_tag: string[]
          source_workspace_id: string | null
          superseded_by: string | null
          valid_from: string | null
          valid_to: string | null
          version: number
        }
        Insert: {
          alternate_question_phrasings: string[]
          answer_advanced?: string | null
          answer_standard: string
          anti_scope_tag: string[]
          changed_at?: string
          changed_by?: string | null
          edit_intent?: string | null
          id?: string
          origin_kind: string
          publication_status: string
          q_a_pair_id: string
          question_text: string
          scope_tag: string[]
          source_workspace_id?: string | null
          superseded_by?: string | null
          valid_from?: string | null
          valid_to?: string | null
          version: number
        }
        Update: {
          alternate_question_phrasings?: string[]
          answer_advanced?: string | null
          answer_standard?: string
          anti_scope_tag?: string[]
          changed_at?: string
          changed_by?: string | null
          edit_intent?: string | null
          id?: string
          origin_kind?: string
          publication_status?: string
          q_a_pair_id?: string
          question_text?: string
          scope_tag?: string[]
          source_workspace_id?: string | null
          superseded_by?: string | null
          valid_from?: string | null
          valid_to?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "q_a_pair_history_q_a_pair_id_fkey"
            columns: ["q_a_pair_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
        ]
      }
      q_a_pairs: {
        Row: {
          alternate_question_phrasings: string[]
          answer_advanced: string | null
          answer_standard: string
          anti_scope_tag: string[]
          created_at: string
          edit_intent: string | null
          id: string
          origin_kind: string
          publication_status: string
          question_text: string
          scope_tag: string[]
          source_document_id: string | null
          source_form_instance_id: string | null
          source_form_response_id: string | null
          source_question_id: string | null
          superseded_by: string | null
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          alternate_question_phrasings?: string[]
          answer_advanced?: string | null
          answer_standard: string
          anti_scope_tag?: string[]
          created_at?: string
          edit_intent?: string | null
          id?: string
          origin_kind?: string
          publication_status?: string
          question_text: string
          scope_tag?: string[]
          source_document_id?: string | null
          source_form_instance_id?: string | null
          source_form_response_id?: string | null
          source_question_id?: string | null
          superseded_by?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          alternate_question_phrasings?: string[]
          answer_advanced?: string | null
          answer_standard?: string
          anti_scope_tag?: string[]
          created_at?: string
          edit_intent?: string | null
          id?: string
          origin_kind?: string
          publication_status?: string
          question_text?: string
          scope_tag?: string[]
          source_document_id?: string | null
          source_form_instance_id?: string | null
          source_form_response_id?: string | null
          source_question_id?: string | null
          superseded_by?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "q_a_pairs_source_form_response_id_fkey"
            columns: ["source_form_response_id"]
            isOneToOne: false
            referencedRelation: "form_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "q_a_pairs_source_form_template_id_fkey"
            columns: ["source_form_instance_id"]
            isOneToOne: false
            referencedRelation: "form_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "q_a_pairs_source_question_id_fkey"
            columns: ["source_question_id"]
            isOneToOne: false
            referencedRelation: "form_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "q_a_pairs_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
        ]
      }
      question_matches: {
        Row: {
          created_at: string
          embedding_score: number | null
          form_question_id: string
          fulltext_score: number | null
          id: string
          matched_at: string
          q_a_pair_id: string
          question_kind: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          embedding_score?: number | null
          form_question_id: string
          fulltext_score?: number | null
          id?: string
          matched_at?: string
          q_a_pair_id: string
          question_kind: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          embedding_score?: number | null
          form_question_id?: string
          fulltext_score?: number | null
          id?: string
          matched_at?: string
          q_a_pair_id?: string
          question_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_matches_form_question_id_fkey"
            columns: ["form_question_id"]
            isOneToOne: false
            referencedRelation: "form_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_matches_q_a_pair_id_fkey"
            columns: ["q_a_pair_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_matches_question_kind_fkey"
            columns: ["question_kind"]
            isOneToOne: false
            referencedRelation: "form_types"
            referencedColumns: ["key"]
          },
        ]
      }
      record_embeddings: {
        Row: {
          created_at: string
          embedding: string | null
          id: string
          model: string
          owner_id: string
          owner_kind: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          id?: string
          model: string
          owner_id: string
          owner_kind: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          embedding?: string | null
          id?: string
          model?: string
          owner_id?: string
          owner_kind?: string
          updated_at?: string
        }
        Relationships: []
      }
      record_lifecycle: {
        Row: {
          content_owner_id: string | null
          created_at: string
          domain: string | null
          expiry_date: string | null
          freshness: string | null
          freshness_checked_at: string | null
          governance_review_due: string | null
          governance_review_status: string | null
          governance_reviewer_id: string | null
          id: string
          lifecycle_type: string | null
          next_review_date: string | null
          owner_id: string | null
          owner_kind: string
          previous_freshness: string | null
          q_a_pair_id: string | null
          review_cadence_days: number | null
          source_document_id: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          content_owner_id?: string | null
          created_at?: string
          domain?: string | null
          expiry_date?: string | null
          freshness?: string | null
          freshness_checked_at?: string | null
          governance_review_due?: string | null
          governance_review_status?: string | null
          governance_reviewer_id?: string | null
          id?: string
          lifecycle_type?: string | null
          next_review_date?: string | null
          owner_id?: string | null
          owner_kind: string
          previous_freshness?: string | null
          q_a_pair_id?: string | null
          review_cadence_days?: number | null
          source_document_id?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          content_owner_id?: string | null
          created_at?: string
          domain?: string | null
          expiry_date?: string | null
          freshness?: string | null
          freshness_checked_at?: string | null
          governance_review_due?: string | null
          governance_review_status?: string | null
          governance_reviewer_id?: string | null
          id?: string
          lifecycle_type?: string | null
          next_review_date?: string | null
          owner_id?: string | null
          owner_kind?: string
          previous_freshness?: string | null
          q_a_pair_id?: string | null
          review_cadence_days?: number | null
          source_document_id?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "record_lifecycle_q_a_pair_id_fkey"
            columns: ["q_a_pair_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_lifecycle_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_items: {
        Row: {
          body: string
          created_at: string
          id: string
          ingestion_source: string
          layer: string | null
          op_id: string | null
          primary_domain: string | null
          primary_subtopic: string | null
          published_at: string | null
          source_document_id: string
          source_url: string
          summary: string | null
          superseded_by: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id: string
          ingestion_source: string
          layer?: string | null
          op_id?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          published_at?: string | null
          source_document_id: string
          source_url: string
          summary?: string | null
          superseded_by?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          ingestion_source?: string
          layer?: string | null
          op_id?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          published_at?: string | null
          source_document_id?: string
          source_url?: string
          summary?: string | null
          superseded_by?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_items_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_items_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "reference_items"
            referencedColumns: ["id"]
          },
        ]
      }
      review_assignments: {
        Row: {
          assigned_by: string
          assignment_type: string
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          filter_content_types: string[] | null
          filter_date_from: string | null
          filter_date_to: string | null
          filter_domains: string[] | null
          filter_freshness: string[] | null
          id: string
          item_count: number | null
          notes: string | null
          reviewer_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          assigned_by: string
          assignment_type?: string
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          filter_content_types?: string[] | null
          filter_date_from?: string | null
          filter_date_to?: string | null
          filter_domains?: string[] | null
          filter_freshness?: string[] | null
          id?: string
          item_count?: number | null
          notes?: string | null
          reviewer_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          assigned_by?: string
          assignment_type?: string
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          filter_content_types?: string[] | null
          filter_date_from?: string | null
          filter_date_to?: string | null
          filter_domains?: string[] | null
          filter_freshness?: string[] | null
          id?: string
          item_count?: number | null
          notes?: string | null
          reviewer_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_assignments_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_proposal_workspaces: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_proposal_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      si_processing_queue: {
        Row: {
          articles_found: number
          articles_new: number
          articles_passed: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          feed_source_id: string
          id: string
          started_at: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          articles_found?: number
          articles_new?: number
          articles_passed?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          feed_source_id: string
          id?: string
          started_at?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          articles_found?: number
          articles_new?: number
          articles_passed?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          feed_source_id?: string
          id?: string
          started_at?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "si_processing_queue_feed_source_id_fkey"
            columns: ["feed_source_id"]
            isOneToOne: false
            referencedRelation: "feed_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "si_processing_queue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_policy: {
        Row: {
          allowed_domain: string | null
          id: boolean
        }
        Insert: {
          allowed_domain?: string | null
          id?: boolean
        }
        Update: {
          allowed_domain?: string | null
          id?: boolean
        }
        Relationships: []
      }
      source_documents: {
        Row: {
          admission_status: string
          ai_keywords: string[] | null
          archived_at: string | null
          archived_by: string | null
          auth: Json | null
          cadence: string | null
          captured_date: string | null
          classification_confidence: number | null
          classification_reasoning: string | null
          classified_at: string | null
          content_hash: string
          content_type: string | null
          created_at: string
          extracted_text: string | null
          extraction_metadata: Json | null
          extraction_method: string | null
          file_size: number
          filename: string
          id: string
          locator: string | null
          logical_path: string | null
          mime_type: string
          op_id: string | null
          origin_type: string | null
          original_filename: string | null
          parent_id: string | null
          pipeline_run_id: string | null
          primary_domain: string
          primary_subtopic: string
          publication_status: string
          retention_class: string | null
          secondary_domain: string | null
          secondary_subtopic: string | null
          source_url: string | null
          status: string
          storage_path: string
          suggested_title: string | null
          summary: string | null
          summary_data: Json | null
          updated_at: string | null
          updated_by: string | null
          uploaded_by: string | null
          version: number
          workspace_id: string | null
        }
        Insert: {
          admission_status?: string
          ai_keywords?: string[] | null
          archived_at?: string | null
          archived_by?: string | null
          auth?: Json | null
          cadence?: string | null
          captured_date?: string | null
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classified_at?: string | null
          content_hash: string
          content_type?: string | null
          created_at?: string
          extracted_text?: string | null
          extraction_metadata?: Json | null
          extraction_method?: string | null
          file_size: number
          filename: string
          id?: string
          locator?: string | null
          logical_path?: string | null
          mime_type: string
          op_id?: string | null
          origin_type?: string | null
          original_filename?: string | null
          parent_id?: string | null
          pipeline_run_id?: string | null
          primary_domain?: string
          primary_subtopic?: string
          publication_status?: string
          retention_class?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_url?: string | null
          status?: string
          storage_path: string
          suggested_title?: string | null
          summary?: string | null
          summary_data?: Json | null
          updated_at?: string | null
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number
          workspace_id?: string | null
        }
        Update: {
          admission_status?: string
          ai_keywords?: string[] | null
          archived_at?: string | null
          archived_by?: string | null
          auth?: Json | null
          cadence?: string | null
          captured_date?: string | null
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classified_at?: string | null
          content_hash?: string
          content_type?: string | null
          created_at?: string
          extracted_text?: string | null
          extraction_metadata?: Json | null
          extraction_method?: string | null
          file_size?: number
          filename?: string
          id?: string
          locator?: string | null
          logical_path?: string | null
          mime_type?: string
          op_id?: string | null
          origin_type?: string | null
          original_filename?: string | null
          parent_id?: string | null
          pipeline_run_id?: string | null
          primary_domain?: string
          primary_subtopic?: string
          publication_status?: string
          retention_class?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_url?: string | null
          status?: string
          storage_path?: string
          suggested_title?: string | null
          summary?: string | null
          summary_data?: Json | null
          updated_at?: string | null
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_documents_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_documents_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_documents_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_morphology_drift_flags: {
        Row: {
          affected_content_ids: string[]
          decided_at: string | null
          decided_by: string | null
          decision: string
          decision_rationale: string | null
          detected_at: string
          id: string
          proposed_canonical: string
          stored_tag: string
          usage_count: number
        }
        Insert: {
          affected_content_ids: string[]
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_rationale?: string | null
          detected_at?: string
          id?: string
          proposed_canonical: string
          stored_tag: string
          usage_count: number
        }
        Update: {
          affected_content_ids?: string[]
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_rationale?: string | null
          detected_at?: string
          id?: string
          proposed_canonical?: string
          stored_tag?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "tag_morphology_drift_flags_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      taxonomy_domains: {
        Row: {
          accepted_at: string | null
          colour: string | null
          created_at: string
          description: string | null
          display_name: string | null
          display_order: number
          id: string
          is_active: boolean | null
          key_signal: string | null
          name: string
          provenance: string
          recommended_at: string | null
          recommended_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          colour?: string | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          display_order?: number
          id?: string
          is_active?: boolean | null
          key_signal?: string | null
          name: string
          provenance: string
          recommended_at?: string | null
          recommended_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          colour?: string | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          display_order?: number
          id?: string
          is_active?: boolean | null
          key_signal?: string | null
          name?: string
          provenance?: string
          recommended_at?: string | null
          recommended_by?: string | null
        }
        Relationships: []
      }
      taxonomy_subtopics: {
        Row: {
          accepted_at: string | null
          created_at: string
          description: string | null
          display_name: string | null
          display_order: number
          domain_id: string
          id: string
          is_active: boolean | null
          name: string
          provenance: string
          recommended_at: string | null
          recommended_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          display_order?: number
          domain_id: string
          id?: string
          is_active?: boolean | null
          name: string
          provenance: string
          recommended_at?: string | null
          recommended_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          display_order?: number
          domain_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          provenance?: string
          recommended_at?: string | null
          recommended_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "taxonomy_subtopics_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_domains"
            referencedColumns: ["id"]
          },
        ]
      }
      taxonomy_sync_state: {
        Row: {
          created_at: string
          id: string
          last_sync_at: string | null
          last_sync_hash: string
          synced_by: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_hash?: string
          synced_by?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_hash?: string
          synced_by?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      template_completions: {
        Row: {
          created_at: string | null
          created_by: string | null
          fields_failed: number | null
          fields_filled: number
          fields_skipped: number | null
          file_size: number | null
          form_instance_id: string
          id: string
          job_id: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          fields_failed?: number | null
          fields_filled: number
          fields_skipped?: number | null
          file_size?: number | null
          form_instance_id: string
          id?: string
          job_id?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          fields_failed?: number | null
          fields_filled?: number
          fields_skipped?: number | null
          file_size?: number | null
          form_instance_id?: string
          id?: string
          job_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_completions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_completions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "processing_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_completions_template_id_fkey"
            columns: ["form_instance_id"]
            isOneToOne: false
            referencedRelation: "form_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_config: {
        Row: {
          config: Json
          created_at: string
          id: boolean
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: boolean
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      training_onboarding_workspaces: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_onboarding_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notification_prefs: {
        Row: {
          auto_generate_change_reports: boolean
          created_at: string
          email_owned_content_flagged: boolean
          email_review_assigned: boolean
          email_weekly_change_report: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_generate_change_reports?: boolean
          created_at?: string
          email_owned_content_flagged?: boolean
          email_review_assigned?: boolean
          email_weekly_change_report?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_generate_change_reports?: boolean
          created_at?: string
          email_owned_content_flagged?: boolean
          email_review_assigned?: boolean
          email_weekly_change_report?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          display_name: string | null
          granted_by: string | null
          id: string
          role: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          granted_by?: string | null
          id?: string
          role?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          granted_by?: string | null
          id?: string
          role?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_history: {
        Row: {
          action_type: string
          id: string
          note: string | null
          owner_kind: string
          performed_at: string
          performed_by: string
          q_a_pair_id: string | null
          source_document_id: string | null
        }
        Insert: {
          action_type: string
          id?: string
          note?: string | null
          owner_kind?: string
          performed_at?: string
          performed_by: string
          q_a_pair_id?: string | null
          source_document_id?: string | null
        }
        Update: {
          action_type?: string
          id?: string
          note?: string | null
          owner_kind?: string
          performed_at?: string
          performed_by?: string
          q_a_pair_id?: string | null
          source_document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_history_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_history_q_a_pair_id_fkey"
            columns: ["q_a_pair_id"]
            isOneToOne: false
            referencedRelation: "q_a_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_history_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          application_type_id: string
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          domain_metadata: Json | null
          icon: string | null
          id: string
          is_archived: boolean | null
          name: string
          status: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          application_type_id: string
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          domain_metadata?: Json | null
          icon?: string | null
          id?: string
          is_archived?: boolean | null
          name: string
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          application_type_id?: string
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          domain_metadata?: Json | null
          icon?: string | null
          id?: string
          is_archived?: boolean | null
          name?: string
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_application_type_id_fkey"
            columns: ["application_type_id"]
            isOneToOne: false
            referencedRelation: "application_types"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _corpus_writer_fence_key: { Args: never; Returns: number }
      _corpus_writer_fence_lease_name: { Args: never; Returns: string }
      _source_document_cascade_erase: {
        Args: { p_id: string; p_trigger?: string }
        Returns: {
          chunks_deleted: number
          embeddings_deleted: number
          entity_mentions_deleted: number
          entity_relationships_deleted: number
          extractions_deleted: number
        }[]
      }
      _test_delete_broken_auth_user: {
        Args: { probe_id: string }
        Returns: undefined
      }
      _test_insert_broken_auth_user: {
        Args: { probe_email: string; probe_id: string }
        Returns: undefined
      }
      bulk_assign_content_owner: {
        Args: {
          p_assigned_by: string
          p_item_ids: string[]
          p_owner_id: string
        }
        Returns: number
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
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          max_attempts: number
          payload: Json
          priority: number
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }[]
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
      delete_duplicate_entity_mentions: {
        Args: { p_canonical_name: string }
        Returns: number
      }
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
      get_capture_activity: {
        Args: { days_back?: number }
        Returns: {
          count: number
          period: string
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
        Returns: {
          article_count: number
          consecutive_failures: number
          created_at: string
          created_by: string | null
          etag: string | null
          id: string
          is_active: boolean
          last_modified: string | null
          last_polled_at: string | null
          last_polled_error: string | null
          last_polled_status: string | null
          name: string
          polling_interval_minutes: number
          source_type: string
          updated_at: string
          url: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "feed_sources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_entity_co_occurrence: {
        Args: { p_entity_type?: string; p_limit?: number; p_min_count?: number }
        Returns: {
          entity_a: string
          entity_b: string
          shared_count: number
          type_a: string
          type_b: string
        }[]
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
      get_entity_name_counts: {
        Args: never
        Returns: {
          canonical_name: string
          mention_count: number
        }[]
      }
      get_entity_relationships_rpc: {
        Args: { p_entity_name: string }
        Returns: {
          confidence: number
          relationship_type: string
          source_document_id: string
          source_entity: string
          target_entity: string
        }[]
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
      get_form_summary: { Args: { workspace_id: string }; Returns: Json }
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
      get_template_summary: {
        Args: { p_template_id: string }
        Returns: {
          confirmed_fields: number
          failed_fields: number
          filled_fields: number
          pending_fields: number
          rejected_fields: number
          skipped_fields: number
          total_fields: number
          unmapped_fields: number
          unreviewed_fields: number
        }[]
      }
      get_user_display_names: {
        Args: { user_ids: string[] }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      get_user_role: { Args: never; Returns: string }
      grant_standard_public_table_access: {
        Args: { target_table: unknown }
        Returns: undefined
      }
      hook_restrict_signup_to_allowed_domain: {
        Args: { event: Json }
        Returns: Json
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
        Returns: {
          alternate_question_phrasings: string[]
          created_at: string
          evaluation_criteria: string | null
          evidence_requirements: string[]
          expected_response_kind: string | null
          extracted_answer_text: string | null
          extracted_question_text: string
          extraction_metadata: Json
          extractor_kind: string
          id: string
          invalidated_at: string | null
          op_id: string | null
          promoted_to_pair_id: string | null
          scope_tags: string[]
          source_document_id: string | null
          updated_at: string
        }[]
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
      search_content:
        | {
            Args: {
              limit_count?: number
              query_embedding: string
              similarity_threshold?: number
            }
            Returns: {
              ai_keywords: string[]
              author_name: string
              captured_date: string
              classification_confidence: number
              content_type: string
              id: string
              platform: string
              primary_domain: string
              primary_subtopic: string
              similarity: number
              source_domain: string
              suggested_title: string
              summary: string
              thumbnail_url: string
              title: string
            }[]
          }
        | {
            Args: {
              limit_count?: number
              query_embedding: string
              similarity_threshold?: number
            }
            Returns: {
              ai_keywords: string[]
              author_name: string
              captured_date: string
              classification_confidence: number
              content_type: string
              id: string
              platform: string
              primary_domain: string
              primary_subtopic: string
              similarity: number
              source_domain: string
              suggested_title: string
              summary: string
              thumbnail_url: string
              title: string
            }[]
          }
      search_content_chunks: {
        Args: {
          filter_overdue_review?: boolean
          filter_review_due_within_days?: number
          filter_source_document_id?: string
          limit_count?: number
          query_embedding: string
          similarity_threshold?: number
          visibility_filter?: string
        }
        Returns: {
          char_count: number
          chunk_id: string
          content: string
          heading_level: number
          heading_path: string[]
          heading_text: string
          item_content_type: string
          item_primary_domain: string
          item_primary_subtopic: string
          item_suggested_title: string
          item_title: string
          position: number
          similarity: number
          source_document_id: string
          word_count: number
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
      cited_target_kind:
        | "content_item"
        | "q_a_pair"
        | "reference_item"
        | "source_document"
        | "concept"
      citing_entity_kind: "form_response"
      outcome_signal: "win" | "fail" | "loop" | "refusal"
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
  public: {
    Enums: {
      cited_target_kind: [
        "content_item",
        "q_a_pair",
        "reference_item",
        "source_document",
        "concept",
      ],
      citing_entity_kind: ["form_response"],
      outcome_signal: ["win", "fail", "loop", "refusal"],
    },
  },
} as const
