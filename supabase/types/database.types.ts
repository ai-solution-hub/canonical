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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      bid_questions: {
        Row: {
          assigned_to: string | null
          confidence_posture: string | null
          created_at: string
          created_by: string | null
          evaluation_weight: number | null
          has_variants: boolean | null
          id: string
          matched_content_ids: string[] | null
          project_id: string
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
          has_variants?: boolean | null
          id?: string
          matched_content_ids?: string[] | null
          project_id: string
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
          has_variants?: boolean | null
          id?: string
          matched_content_ids?: string[] | null
          project_id?: string
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
            foreignKeyName: "bid_questions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_questions_template_requirement_id_fkey"
            columns: ["template_requirement_id"]
            isOneToOne: false
            referencedRelation: "template_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_response_history: {
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
          source_content_ids: string[] | null
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
          source_content_ids?: string[] | null
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
          source_content_ids?: string[] | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bid_response_history_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "bid_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_responses: {
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
          source_content_ids: string[] | null
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
          source_content_ids?: string[] | null
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
          source_content_ids?: string[] | null
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bid_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "bid_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_disputes: {
        Row: {
          content_item_id: string
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
          status: string
          updated_at: string
        }
        Insert: {
          content_item_id: string
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
          status?: string
          updated_at?: string
        }
        Update: {
          content_item_id?: string
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
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classification_disputes_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          certifications: string[]
          company_embedding: string | null
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
          company_embedding?: string | null
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
          company_embedding?: string | null
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
        Relationships: []
      }
      content_chunks: {
        Row: {
          char_count: number
          content: string
          content_item_id: string
          created_at: string
          embedding: string | null
          heading_level: number | null
          heading_path: string[]
          heading_text: string | null
          id: string
          parent_chunk_id: string | null
          position: number
          updated_at: string
          word_count: number
        }
        Insert: {
          char_count?: number
          content: string
          content_item_id: string
          created_at?: string
          embedding?: string | null
          heading_level?: number | null
          heading_path?: string[]
          heading_text?: string | null
          id?: string
          parent_chunk_id?: string | null
          position: number
          updated_at?: string
          word_count?: number
        }
        Update: {
          char_count?: number
          content?: string
          content_item_id?: string
          created_at?: string
          embedding?: string | null
          heading_level?: number | null
          heading_path?: string[]
          heading_text?: string | null
          id?: string
          parent_chunk_id?: string | null
          position?: number
          updated_at?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_chunks_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_chunks_parent_chunk_id_fkey"
            columns: ["parent_chunk_id"]
            isOneToOne: false
            referencedRelation: "content_chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      content_citations: {
        Row: {
          bid_response_id: string
          citation_type: string
          content_item_id: string
          created_at: string | null
          created_by: string | null
          id: string
        }
        Insert: {
          bid_response_id: string
          citation_type?: string
          content_item_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
        }
        Update: {
          bid_response_id?: string
          citation_type?: string
          content_item_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_citations_bid_response_id_fkey"
            columns: ["bid_response_id"]
            isOneToOne: false
            referencedRelation: "bid_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_citations_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_history: {
        Row: {
          brief: string | null
          change_reason: string | null
          change_summary: string | null
          change_type: string
          content: string
          content_item_id: string | null
          created_at: string
          created_by: string | null
          detail: string | null
          id: string
          metadata: Json | null
          reference: string | null
          title: string
          version: number
        }
        Insert: {
          brief?: string | null
          change_reason?: string | null
          change_summary?: string | null
          change_type: string
          content: string
          content_item_id?: string | null
          created_at?: string
          created_by?: string | null
          detail?: string | null
          id?: string
          metadata?: Json | null
          reference?: string | null
          title: string
          version: number
        }
        Update: {
          brief?: string | null
          change_reason?: string | null
          change_summary?: string | null
          change_type?: string
          content?: string
          content_item_id?: string | null
          created_at?: string
          created_by?: string | null
          detail?: string | null
          id?: string
          metadata?: Json | null
          reference?: string | null
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_history_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_item_workspaces: {
        Row: {
          assigned_at: string | null
          content_item_id: string
          id: string
          workspace_id: string
        }
        Insert: {
          assigned_at?: string | null
          content_item_id: string
          id?: string
          workspace_id: string
        }
        Update: {
          assigned_at?: string | null
          content_item_id?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_item_workspaces_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_item_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          ai_keywords: string[] | null
          answer_advanced: string | null
          answer_standard: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          author_name: string | null
          brief: string | null
          captured_date: string | null
          citation_count: number
          classification_cache_creation_tokens: number | null
          classification_cache_read_tokens: number | null
          classification_confidence: number | null
          classification_model: string | null
          classification_reasoning: string | null
          classification_tokens_in: number | null
          classification_tokens_out: number | null
          classified_at: string | null
          content: string
          content_owner_id: string | null
          content_text_hash: string | null
          content_type: string
          created_at: string
          created_by: string | null
          dedup_status: string
          detail: string | null
          embedding: string | null
          embedding_model: string | null
          embedding_tokens: number | null
          expiry_date: string | null
          file_path: string | null
          freshness: string | null
          freshness_checked_at: string | null
          governance_review_due: string | null
          governance_review_status: string | null
          governance_reviewer_id: string | null
          id: string
          layer: string | null
          lifecycle_type: string | null
          metadata: Json | null
          notes: string | null
          parent_id: string | null
          platform: string | null
          previous_freshness: string | null
          previous_quality_score: number | null
          primary_domain: string | null
          primary_subtopic: string | null
          priority: string | null
          quality_score: number | null
          quality_score_updated_at: string | null
          reference: string | null
          secondary_domain: string | null
          secondary_subtopic: string | null
          source_bid: string | null
          source_document: string | null
          source_document_id: string | null
          source_domain: string | null
          source_file: string | null
          source_url: string | null
          starred: boolean
          suggested_title: string | null
          summary: string | null
          summary_data: Json | null
          superseded_by: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
          updated_by: string | null
          user_tags: string[] | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          ai_keywords?: string[] | null
          answer_advanced?: string | null
          answer_standard?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          author_name?: string | null
          brief?: string | null
          captured_date?: string | null
          citation_count?: number
          classification_cache_creation_tokens?: number | null
          classification_cache_read_tokens?: number | null
          classification_confidence?: number | null
          classification_model?: string | null
          classification_reasoning?: string | null
          classification_tokens_in?: number | null
          classification_tokens_out?: number | null
          classified_at?: string | null
          content: string
          content_owner_id?: string | null
          content_text_hash?: string | null
          content_type: string
          created_at?: string
          created_by?: string | null
          dedup_status?: string
          detail?: string | null
          embedding?: string | null
          embedding_model?: string | null
          embedding_tokens?: number | null
          expiry_date?: string | null
          file_path?: string | null
          freshness?: string | null
          freshness_checked_at?: string | null
          governance_review_due?: string | null
          governance_review_status?: string | null
          governance_reviewer_id?: string | null
          id?: string
          layer?: string | null
          lifecycle_type?: string | null
          metadata?: Json | null
          notes?: string | null
          parent_id?: string | null
          platform?: string | null
          previous_freshness?: string | null
          previous_quality_score?: number | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          priority?: string | null
          quality_score?: number | null
          quality_score_updated_at?: string | null
          reference?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_bid?: string | null
          source_document?: string | null
          source_document_id?: string | null
          source_domain?: string | null
          source_file?: string | null
          source_url?: string | null
          starred?: boolean
          suggested_title?: string | null
          summary?: string | null
          summary_data?: Json | null
          superseded_by?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
          updated_by?: string | null
          user_tags?: string[] | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          ai_keywords?: string[] | null
          answer_advanced?: string | null
          answer_standard?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          author_name?: string | null
          brief?: string | null
          captured_date?: string | null
          citation_count?: number
          classification_cache_creation_tokens?: number | null
          classification_cache_read_tokens?: number | null
          classification_confidence?: number | null
          classification_model?: string | null
          classification_reasoning?: string | null
          classification_tokens_in?: number | null
          classification_tokens_out?: number | null
          classified_at?: string | null
          content?: string
          content_owner_id?: string | null
          content_text_hash?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          dedup_status?: string
          detail?: string | null
          embedding?: string | null
          embedding_model?: string | null
          embedding_tokens?: number | null
          expiry_date?: string | null
          file_path?: string | null
          freshness?: string | null
          freshness_checked_at?: string | null
          governance_review_due?: string | null
          governance_review_status?: string | null
          governance_reviewer_id?: string | null
          id?: string
          layer?: string | null
          lifecycle_type?: string | null
          metadata?: Json | null
          notes?: string | null
          parent_id?: string | null
          platform?: string | null
          previous_freshness?: string | null
          previous_quality_score?: number | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          priority?: string | null
          quality_score?: number | null
          quality_score_updated_at?: string | null
          reference?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_bid?: string | null
          source_document?: string | null
          source_document_id?: string | null
          source_domain?: string | null
          source_file?: string | null
          source_url?: string | null
          starred?: boolean
          suggested_title?: string | null
          summary?: string | null
          summary_data?: Json | null
          superseded_by?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          user_tags?: string[] | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_source_bid_fkey"
            columns: ["source_bid"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_templates: {
        Row: {
          brief_template: string | null
          content_template: string
          content_type: string
          created_at: string
          created_by: string | null
          default_tags: string[] | null
          description: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          slug: string
          suggested_domain: string | null
          title_template: string
          updated_at: string | null
        }
        Insert: {
          brief_template?: string | null
          content_template?: string
          content_type: string
          created_at?: string
          created_by?: string | null
          default_tags?: string[] | null
          description?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          slug: string
          suggested_domain?: string | null
          title_template?: string
          updated_at?: string | null
        }
        Update: {
          brief_template?: string | null
          content_template?: string
          content_type?: string
          created_at?: string
          created_by?: string | null
          default_tags?: string[] | null
          description?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          suggested_domain?: string | null
          title_template?: string
          updated_at?: string | null
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
            foreignKeyName: "coverage_targets_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_domains"
            referencedColumns: ["id"]
          },
        ]
      }
      digests: {
        Row: {
          created_at: string
          created_by: string | null
          digest_type: string
          domain_summaries: Json
          generated_at: string
          generated_by: string
          id: string
          item_count: number
          item_ids: string[] | null
          metadata: Json | null
          narrative_summary: string | null
          period_end: string
          period_start: string
          theme_clusters: Json
          tokens_used: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          digest_type?: string
          domain_summaries?: Json
          generated_at?: string
          generated_by?: string
          id?: string
          item_count?: number
          item_ids?: string[] | null
          metadata?: Json | null
          narrative_summary?: string | null
          period_end: string
          period_start: string
          theme_clusters?: Json
          tokens_used?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          digest_type?: string
          domain_summaries?: Json
          generated_at?: string
          generated_by?: string
          id?: string
          item_count?: number
          item_ids?: string[] | null
          metadata?: Json | null
          narrative_summary?: string | null
          period_end?: string
          period_start?: string
          theme_clusters?: Json
          tokens_used?: number | null
        }
        Relationships: []
      }
      entity_aliases: {
        Row: {
          alias: string
          canonical: string
          category: string
          created_at: string
          id: string
          is_active: boolean
        }
        Insert: {
          alias: string
          canonical: string
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
        }
        Update: {
          alias?: string
          canonical?: string
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      entity_mentions: {
        Row: {
          canonical_name: string
          confidence: number | null
          content_item_id: string
          context_snippet: string | null
          created_at: string | null
          entity_name: string
          entity_type: string
          entity_type_override: string | null
          id: string
          metadata: Json | null
          normalisation_version: number | null
        }
        Insert: {
          canonical_name: string
          confidence?: number | null
          content_item_id: string
          context_snippet?: string | null
          created_at?: string | null
          entity_name: string
          entity_type: string
          entity_type_override?: string | null
          id?: string
          metadata?: Json | null
          normalisation_version?: number | null
        }
        Update: {
          canonical_name?: string
          confidence?: number | null
          content_item_id?: string
          context_snippet?: string | null
          created_at?: string | null
          entity_name?: string
          entity_type?: string
          entity_type_override?: string | null
          id?: string
          metadata?: Json | null
          normalisation_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_mentions_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_relationships: {
        Row: {
          confidence: number | null
          created_at: string | null
          id: string
          relationship_type: string
          source_entity: string
          source_item_id: string | null
          target_entity: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          id?: string
          relationship_type: string
          source_entity: string
          source_item_id?: string | null
          target_entity: string
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          id?: string
          relationship_type?: string
          source_entity?: string
          source_item_id?: string | null
          target_entity?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_articles: {
        Row: {
          ai_summary: string | null
          content_item_id: string | null
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
          relevance_category: string | null
          relevance_reasoning: string | null
          relevance_score: number | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_summary?: string | null
          content_item_id?: string | null
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
          relevance_category?: string | null
          relevance_reasoning?: string | null
          relevance_score?: number | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_summary?: string | null
          content_item_id?: string | null
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
          relevance_category?: string | null
          relevance_reasoning?: string | null
          relevance_score?: number | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_articles_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "feed_flags_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "feed_prompts"
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
            foreignKeyName: "feed_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: []
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
        Relationships: []
      }
      ingestion_quality_log: {
        Row: {
          content_item_id: string | null
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
          source_url: string | null
        }
        Insert: {
          content_item_id?: string | null
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
          source_url?: string | null
        }
        Update: {
          content_item_id?: string | null
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
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_quality_log_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
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
          error_message: string | null
          id: string
          items_created: string[] | null
          items_processed: number | null
          items_skipped: number | null
          items_updated: number | null
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
          error_message?: string | null
          id?: string
          items_created?: string[] | null
          items_processed?: number | null
          items_skipped?: number | null
          items_updated?: number | null
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
          error_message?: string | null
          id?: string
          items_created?: string[] | null
          items_processed?: number | null
          items_skipped?: number | null
          items_updated?: number | null
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
      read_marks: {
        Row: {
          content_item_id: string
          id: string
          read_at: string
          source: string
          user_id: string
        }
        Insert: {
          content_item_id: string
          id?: string
          read_at?: string
          source?: string
          user_id: string
        }
        Update: {
          content_item_id?: string
          id?: string
          read_at?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "read_marks_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
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
        Relationships: []
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
      source_document_diffs: {
        Row: {
          affected_content_item_id: string | null
          created_at: string | null
          created_by: string | null
          diff_mode: string
          diff_type: string
          id: string
          new_content: string | null
          new_document_id: string
          new_question: string | null
          old_content: string | null
          old_document_id: string
          old_question: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          section_header: string | null
          similarity_score: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          affected_content_item_id?: string | null
          created_at?: string | null
          created_by?: string | null
          diff_mode?: string
          diff_type: string
          id?: string
          new_content?: string | null
          new_document_id: string
          new_question?: string | null
          old_content?: string | null
          old_document_id: string
          old_question?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          section_header?: string | null
          similarity_score?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          affected_content_item_id?: string | null
          created_at?: string | null
          created_by?: string | null
          diff_mode?: string
          diff_type?: string
          id?: string
          new_content?: string | null
          new_document_id?: string
          new_question?: string | null
          old_content?: string | null
          old_document_id?: string
          old_question?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          section_header?: string | null
          similarity_score?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_document_diffs_affected_content_item_id_fkey"
            columns: ["affected_content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_document_diffs_new_document_id_fkey"
            columns: ["new_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_document_diffs_old_document_id_fkey"
            columns: ["old_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      source_documents: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          content_hash: string
          created_at: string
          extracted_text: string | null
          extraction_metadata: Json | null
          file_size: number
          filename: string
          id: string
          mime_type: string
          original_filename: string
          parent_id: string | null
          pipeline_run_id: string | null
          status: string
          storage_path: string
          uploaded_by: string | null
          version: number
          workspace_id: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          content_hash: string
          created_at?: string
          extracted_text?: string | null
          extraction_metadata?: Json | null
          file_size: number
          filename: string
          id?: string
          mime_type: string
          original_filename: string
          parent_id?: string | null
          pipeline_run_id?: string | null
          status?: string
          storage_path: string
          uploaded_by?: string | null
          version?: number
          workspace_id?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          content_hash?: string
          created_at?: string
          extracted_text?: string | null
          extraction_metadata?: Json | null
          file_size?: number
          filename?: string
          id?: string
          mime_type?: string
          original_filename?: string
          parent_id?: string | null
          pipeline_run_id?: string | null
          status?: string
          storage_path?: string
          uploaded_by?: string | null
          version?: number
          workspace_id?: string | null
        }
        Relationships: [
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
            foreignKeyName: "source_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
          id: string
          job_id: string | null
          storage_path: string
          template_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          fields_failed?: number | null
          fields_filled: number
          fields_skipped?: number | null
          file_size?: number | null
          id?: string
          job_id?: string | null
          storage_path: string
          template_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          fields_failed?: number | null
          fields_filled?: number
          fields_skipped?: number | null
          file_size?: number | null
          id?: string
          job_id?: string | null
          storage_path?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_completions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "processing_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_completions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      template_fields: {
        Row: {
          col_index: number | null
          created_at: string | null
          field_type: string
          fill_error: string | null
          fill_status: string
          id: string
          mapping_confidence: number | null
          mapping_status: string
          placeholder_text: string | null
          question_id: string | null
          question_text: string | null
          row_index: number | null
          section_name: string | null
          sequence: number
          table_index: number | null
          template_id: string
          updated_at: string | nu