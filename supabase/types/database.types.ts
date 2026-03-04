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
          question_sequence?: number
          question_text: string
          section_name?: string | null
          section_sequence?: number
          status?: string
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
          updated_at?: string | null
          word_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_questions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      content_history: {
        Row: {
          brief: string | null
          change_summary: string | null
          change_type: string
          content: string
          content_item_id: string
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
          change_summary?: string | null
          change_type?: string
          content: string
          content_item_id: string
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
          change_summary?: string | null
          change_type?: string
          content?: string
          content_item_id?: string
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
          {
            foreignKeyName: "content_history_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      content_item_projects: {
        Row: {
          assigned_at: string | null
          content_item_id: string
          id: string
          project_id: string
        }
        Insert: {
          assigned_at?: string | null
          content_item_id: string
          id?: string
          project_id: string
        }
        Update: {
          assigned_at?: string | null
          content_item_id?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_item_projects_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_item_projects_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_item_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          ai_keywords: string[] | null
          ai_summary: string | null
          author_name: string | null
          brief: string | null
          captured_date: string | null
          classification_confidence: number | null
          classification_reasoning: string | null
          classified_at: string | null
          content: string
          content_type: string
          created_at: string
          created_by: string | null
          detail: string | null
          embedding: string | null
          expiry_date: string | null
          file_path: string | null
          freshness: string | null
          freshness_checked_at: string | null
          governance_review_due: string | null
          governance_review_status: string | null
          governance_reviewer_id: string | null
          id: string
          lifecycle_type: string | null
          metadata: Json | null
          parent_id: string | null
          platform: string | null
          primary_domain: string | null
          primary_subtopic: string | null
          priority: string | null
          reference: string | null
          secondary_domain: string | null
          secondary_subtopic: string | null
          source_bid: string | null
          source_document: string | null
          source_domain: string | null
          source_url: string | null
          suggested_title: string | null
          summary_data: Json | null
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
          ai_summary?: string | null
          author_name?: string | null
          brief?: string | null
          captured_date?: string | null
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classified_at?: string | null
          content: string
          content_type: string
          created_at?: string
          created_by?: string | null
          detail?: string | null
          embedding?: string | null
          expiry_date?: string | null
          file_path?: string | null
          freshness?: string | null
          freshness_checked_at?: string | null
          governance_review_due?: string | null
          governance_review_status?: string | null
          governance_reviewer_id?: string | null
          id?: string
          lifecycle_type?: string | null
          metadata?: Json | null
          parent_id?: string | null
          platform?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          priority?: string | null
          reference?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_bid?: string | null
          source_document?: string | null
          source_domain?: string | null
          source_url?: string | null
          suggested_title?: string | null
          summary_data?: Json | null
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
          ai_summary?: string | null
          author_name?: string | null
          brief?: string | null
          captured_date?: string | null
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classified_at?: string | null
          content?: string
          content_type?: string
          created_at?: string
          created_by?: string | null
          detail?: string | null
          embedding?: string | null
          expiry_date?: string | null
          file_path?: string | null
          freshness?: string | null
          freshness_checked_at?: string | null
          governance_review_due?: string | null
          governance_review_status?: string | null
          governance_reviewer_id?: string | null
          id?: string
          lifecycle_type?: string | null
          metadata?: Json | null
          parent_id?: string | null
          platform?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          priority?: string | null
          reference?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_bid?: string | null
          source_document?: string | null
          source_domain?: string | null
          source_url?: string | null
          suggested_title?: string | null
          summary_data?: Json | null
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
            foreignKeyName: "content_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "content_items_overview"
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
      governance_config: {
        Row: {
          created_at: string | null
          created_by: string | null
          domain: string
          id: string
          posture: string
          reviewer_id: string | null
          timeout_days: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          domain: string
          id?: string
          posture?: string
          reviewer_id?: string | null
          timeout_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          domain?: string
          id?: string
          posture?: string
          reviewer_id?: string | null
          timeout_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
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
          {
            foreignKeyName: "ingestion_quality_log_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items_overview"
            referencedColumns: ["id"]
          },
        ]
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
          items_processed: number | null
          pipeline_name: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          items_processed?: number | null
          pipeline_name: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          items_processed?: number | null
          pipeline_name?: string
          started_at?: string
          status?: string
        }
        Relationships: []
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
          started_at: string | null
          status: string
          updated_at: string | null
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
          started_at?: string | null
          status?: string
          updated_at?: string | null
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
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          domain_metadata: Json | null
          icon: string | null
          id: string
          is_archived: boolean | null
          name: string
          type: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          domain_metadata?: Json | null
          icon?: string | null
          id?: string
          is_archived?: boolean | null
          name: string
          type?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          domain_metadata?: Json | null
          icon?: string | null
          id?: string
          is_archived?: boolean | null
          name?: string
          type?: string
          updated_at?: string | null
          updated_by?: string | null
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
          {
            foreignKeyName: "read_marks_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      taxonomy_domains: {
        Row: {
          colour: string | null
          created_at: string
          display_order: number
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          colour?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          colour?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      taxonomy_subtopics: {
        Row: {
          created_at: string
          display_order: number
          domain_id: string
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          domain_id: string
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          created_at?: string
          display_order?: number
          domain_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      content_items_overview: {
        Row: {
          author_name: string | null
          captured_date: string | null
          content_type: string | null
          created_at: string | null
          created_by: string | null
          freshness: string | null
          has_embedding: boolean | null
          has_thumbnail: boolean | null
          id: string | null
          is_classified: boolean | null
          lifecycle_type: string | null
          platform: string | null
          primary_domain: string | null
          primary_subtopic: string | null
          source_domain: string | null
          title: string | null
        }
        Insert: {
          author_name?: string | null
          captured_date?: string | null
          content_type?: string | null
          created_at?: string | null
          created_by?: string | null
          freshness?: string | null
          has_embedding?: never
          has_thumbnail?: never
          id?: string | null
          is_classified?: never
          lifecycle_type?: string | null
          platform?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          source_domain?: string | null
          title?: string | null
        }
        Update: {
          author_name?: string | null
          captured_date?: string | null
          content_type?: string | null
          created_at?: string | null
          created_by?: string | null
          freshness?: string | null
          has_embedding?: never
          has_thumbnail?: never
          id?: string | null
          is_classified?: never
          lifecycle_type?: string | null
          platform?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          source_domain?: string | null
          title?: string | null
        }
        Relationships: []
      }
      quality_issues_pending: {
        Row: {
          content_title: string | null
          content_type: string | null
          created_at: string | null
          details: Json | null
          flag_type: string | null
          id: string | null
          ingestion_batch: string | null
          platform: string | null
          severity: string | null
          source_url: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_content_exists: {
        Args: { ids: string[] }
        Returns: {
          id: string
          item_exists: boolean
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
          job_type: string
          max_attempts: number
          payload: Json
          priority: number
          started_at: string | null
          status: string
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "processing_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      filter_by_keywords: {
        Args: { search_terms: string[] }
        Returns: string[]
      }
      find_similar_content: {
        Args: {
          limit_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          author_name: string
          content: string
          content_type: string
          id: string
          platform: string
          similarity: number
          source_domain: string
          title: string
        }[]
      }
      get_author_analysis: { Args: { p_author_name: string }; Returns: Json }
      get_bid_question_stats: {
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
      get_bid_question_stats_batch: {
        Args: { p_project_ids: string[] }
        Returns: {
          complete_count: number
          drafted_count: number
          needs_sme_count: number
          no_content_count: number
          partial_match_count: number
          project_id: string
          strong_match_count: number
          total_questions: number
          unmatched_count: number
        }[]
      }
      get_bid_summary: { Args: { p_project_id: string }; Returns: Json }
      get_capture_activity: {
        Args: never
        Returns: {
          count: number
          day: string
        }[]
      }
      get_content_gaps: { Args: never; Returns: Json }
      get_domain_subtopic_counts: {
        Args: never
        Returns: {
          item_count: number
          primary_domain: string
          primary_subtopic: string
        }[]
      }
      get_filter_counts: { Args: never; Returns: Json }
      get_freshness_breakdown: {
        Args: never
        Returns: {
          count: number
          freshness: string
        }[]
      }
      get_item_projects: {
        Args: { p_item_id: string }
        Returns: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          domain_metadata: Json | null
          icon: string | null
          id: string
          is_archived: boolean | null
          name: string
          type: string
          updated_at: string | null
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_items_with_quality_flags: { Args: never; Returns: string[] }
      get_popular_keywords: {
        Args: { p_limit?: number }
        Returns: {
          item_count: number
          keyword: string
        }[]
      }
      get_project_counts: { Args: never; Returns: Json }
      get_project_item_counts: {
        Args: never
        Returns: {
          item_count: number
          last_activity: string
          project_id: string
        }[]
      }
      get_quality_issue_counts: {
        Args: never
        Returns: {
          flag_type: string
          open_count: number
          severity: string
        }[]
      }
      get_reading_patterns: { Args: { p_days?: number }; Returns: Json }
      get_source_documents: {
        Args: never
        Returns: {
          count: number
          source_document: string
        }[]
      }
      get_top_authors: {
        Args: { p_limit?: number }
        Returns: {
          author_name: string
          item_count: number
        }[]
      }
      get_topic_deep_dive: { Args: { p_keyword: string }; Returns: Json }
      get_trend_analysis: {
        Args: { p_days?: number; p_min_count?: number }
        Returns: {
          current_count: number
          domains: string[]
          growth_rate: number
          keyword: string
          previous_count: number
        }[]
      }
      get_unique_authors: {
        Args: never
        Returns: {
          author_name: string
          count: number
        }[]
      }
      get_user_role: { Args: never; Returns: string }
      get_user_tag_counts: { Args: never; Returns: Json }
      get_verification_stats: { Args: never; Returns: Json }
      hybrid_search: {
        Args: {
          limit_count?: number
          query_embedding: string
          query_text: string
          similarity_threshold?: number
        }
        Returns: {
          ai_keywords: string[]
          ai_summary: string
          author_name: string
          captured_date: string
          classification_confidence: number
          content_type: string
          created_by: string
          id: string
          metadata: Json
          platform: string
          primary_domain: string
          primary_subtopic: string
          priority: string
          similarity: number
          snippet: string
          source_domain: string
          suggested_title: string
          thumbnail_url: string
          title: string
        }[]
      }
      merge_item_metadata: {
        Args: { p_item_id: string; p_new_data: Json }
        Returns: undefined
      }
      recalculate_all_freshness: {
        Args: never
        Returns: {
          aging_count: number
          expired_count: number
          fresh_count: number
          stale_count: number
          total_updated: number
        }[]
      }
      run_quality_scan: {
        Args: { p_batch_name?: string }
        Returns: {
          flags_created: number
          issue_type: string
          items_found: number
        }[]
      }
      search_content: {
        Args: {
          limit_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          ai_keywords: string[]
          ai_summary: string
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
          thumbnail_url: string
          title: string
        }[]
      }
      search_for_bid_response: {
        Args: {
          limit_count?: number
          query_embedding: string
          query_text?: string
        }
        Returns: {
          ai_keywords: string[]
          brief: string
          content: string
          content_type: string
          detail: string
          id: string
          primary_domain: string
          primary_subtopic: string
          similarity: number
          title: string
        }[]
      }
      toggle_star: {
        Args: { p_item_id: string; p_starred: boolean }
        Returns: undefined
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
  public: {
    Enums: {},
  },
} as const
