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
          author_url: string | null
          captured_date: string | null
          classification_confidence: number | null
          classification_reasoning: string | null
          classified_at: string | null
          content: string
          content_type: string
          created_at: string | null
          embedding: string | null
          engagement_metrics: Json | null
          file_path: string | null
          highlights: Json | null
          id: string
          metadata: Json | null
          parent_id: string | null
          platform: string | null
          primary_domain: string | null
          primary_subtopic: string | null
          priority: string | null
          secondary_domain: string | null
          secondary_subtopic: string | null
          segments: Json | null
          source_domain: string | null
          source_url: string | null
          suggested_title: string | null
          summary_data: Json | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
          user_tags: string[] | null
        }
        Insert: {
          ai_keywords?: string[] | null
          ai_summary?: string | null
          author_name?: string | null
          author_url?: string | null
          captured_date?: string | null
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classified_at?: string | null
          content: string
          content_type?: string
          created_at?: string | null
          embedding?: string | null
          engagement_metrics?: Json | null
          file_path?: string | null
          highlights?: Json | null
          id?: string
          metadata?: Json | null
          parent_id?: string | null
          platform?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          priority?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          segments?: Json | null
          source_domain?: string | null
          source_url?: string | null
          suggested_title?: string | null
          summary_data?: Json | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
          user_tags?: string[] | null
        }
        Update: {
          ai_keywords?: string[] | null
          ai_summary?: string | null
          author_name?: string | null
          author_url?: string | null
          captured_date?: string | null
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classified_at?: string | null
          content?: string
          content_type?: string
          created_at?: string | null
          embedding?: string | null
          engagement_metrics?: Json | null
          file_path?: string | null
          highlights?: Json | null
          id?: string
          metadata?: Json | null
          parent_id?: string | null
          platform?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          priority?: string | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          segments?: Json | null
          source_domain?: string | null
          source_url?: string | null
          suggested_title?: string | null
          summary_data?: Json | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          user_tags?: string[] | null
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
          share_branding: Json | null
          share_expires_at: string | null
          share_item_urls: Json | null
          share_token: string | null
          theme_clusters: Json
          tokens_used: number | null
        }
        Insert: {
          created_at?: string
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
          share_branding?: Json | null
          share_expires_at?: string | null
          share_item_urls?: Json | null
          share_token?: string | null
          theme_clusters?: Json
          tokens_used?: number | null
        }
        Update: {
          created_at?: string
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
          share_branding?: Json | null
          share_expires_at?: string | null
          share_item_urls?: Json | null
          share_token?: string | null
          theme_clusters?: Json
          tokens_used?: number | null
        }
        Relationships: []
      }
      idea_keywords: {
        Row: {
          created_at: string | null
          id: string
          idea_id: string
          is_user_added: boolean | null
          keyword: string
          keyword_lower: string | null
          relevance_score: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          idea_id: string
          is_user_added?: boolean | null
          keyword: string
          keyword_lower?: string | null
          relevance_score?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          idea_id?: string
          is_user_added?: boolean | null
          keyword?: string
          keyword_lower?: string | null
          relevance_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "idea_keywords_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_keywords_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_relationships: {
        Row: {
          created_at: string | null
          id: string
          idea_id: string
          notes: string | null
          related_idea_id: string
          relationship_type: string
          strength: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          idea_id: string
          notes?: string | null
          related_idea_id: string
          relationship_type: string
          strength?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          idea_id?: string
          notes?: string | null
          related_idea_id?: string
          relationship_type?: string
          strength?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idea_relationships_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_relationships_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_relationships_related_idea_id_fkey"
            columns: ["related_idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_relationships_related_idea_id_fkey"
            columns: ["related_idea_id"]
            isOneToOne: false
            referencedRelation: "ideas_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_theme_assignments: {
        Row: {
          assigned_at: string | null
          id: string
          idea_id: string
          theme_id: string
        }
        Insert: {
          assigned_at?: string | null
          id?: string
          idea_id: string
          theme_id: string
        }
        Update: {
          assigned_at?: string | null
          id?: string
          idea_id?: string
          theme_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idea_theme_assignments_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_theme_assignments_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_theme_assignments_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "idea_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_themes: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_archived: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ideas: {
        Row: {
          ai_keywords: string[] | null
          ai_summary: string | null
          ai_themes: string[] | null
          captured_date: string | null
          classification_confidence: number | null
          classified_at: string | null
          content: string
          created_at: string | null
          embedding: string | null
          estimated_effort_hours: number | null
          id: string
          implementation_complexity: string | null
          metadata: Json | null
          parent_id: string | null
          primary_domain: string | null
          primary_subtopic: string | null
          priority: string | null
          relevance_score: number | null
          secondary_domain: string | null
          secondary_subtopic: string | null
          source_author: string | null
          source_content_item_id: string | null
          source_title: string | null
          source_type: string
          source_url: string | null
          status: string | null
          tana_node_id: string | null
          tana_sync_hash: string | null
          tana_synced_at: string | null
          target_timeline: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          ai_keywords?: string[] | null
          ai_summary?: string | null
          ai_themes?: string[] | null
          captured_date?: string | null
          classification_confidence?: number | null
          classified_at?: string | null
          content: string
          created_at?: string | null
          embedding?: string | null
          estimated_effort_hours?: number | null
          id?: string
          implementation_complexity?: string | null
          metadata?: Json | null
          parent_id?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          priority?: string | null
          relevance_score?: number | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_author?: string | null
          source_content_item_id?: string | null
          source_title?: string | null
          source_type: string
          source_url?: string | null
          status?: string | null
          tana_node_id?: string | null
          tana_sync_hash?: string | null
          tana_synced_at?: string | null
          target_timeline?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_keywords?: string[] | null
          ai_summary?: string | null
          ai_themes?: string[] | null
          captured_date?: string | null
          classification_confidence?: number | null
          classified_at?: string | null
          content?: string
          created_at?: string | null
          embedding?: string | null
          estimated_effort_hours?: number | null
          id?: string
          implementation_complexity?: string | null
          metadata?: Json | null
          parent_id?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          priority?: string | null
          relevance_score?: number | null
          secondary_domain?: string | null
          secondary_subtopic?: string | null
          source_author?: string | null
          source_content_item_id?: string | null
          source_title?: string | null
          source_type?: string
          source_url?: string | null
          status?: string | null
          tana_node_id?: string | null
          tana_sync_hash?: string | null
          tana_synced_at?: string | null
          target_timeline?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ideas_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ideas_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ideas_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ideas_source_content_item_id_fkey"
            columns: ["source_content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ideas_source_content_item_id_fkey"
            columns: ["source_content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_quality_log: {
        Row: {
          content_item_id: string | null
          created_at: string | null
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
      pipeline_runs: {
        Row: {
          completed_at: string | null
          cost: number | null
          created_at: string
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
          error_message?: string | null
          id?: string
          items_processed?: number | null
          pipeline_name?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_archived: boolean | null
          name: string
          tana_node_id: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean | null
          name: string
          tana_node_id?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean | null
          name?: string
          tana_node_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      read_marks: {
        Row: {
          content_item_id: string
          id: string
          read_at: string
          source: string
        }
        Insert: {
          content_item_id: string
          id?: string
          read_at?: string
          source?: string
        }
        Update: {
          content_item_id?: string
          id?: string
          read_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "read_marks_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: true
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_marks_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: true
            referencedRelation: "content_items_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      tana_sync_log: {
        Row: {
          error_message: string | null
          id: string
          nodes_synced: number | null
          sync_direction: string | null
          sync_duration_ms: number | null
          sync_status: string | null
          synced_at: string | null
          synced_idea_id: string | null
          tana_node_id: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          nodes_synced?: number | null
          sync_direction?: string | null
          sync_duration_ms?: number | null
          sync_status?: string | null
          synced_at?: string | null
          synced_idea_id?: string | null
          tana_node_id?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          nodes_synced?: number | null
          sync_direction?: string | null
          sync_duration_ms?: number | null
          sync_status?: string | null
          synced_at?: string | null
          synced_idea_id?: string | null
          tana_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tana_sync_log_synced_idea_id_fkey"
            columns: ["synced_idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tana_sync_log_synced_idea_id_fkey"
            columns: ["synced_idea_id"]
            isOneToOne: false
            referencedRelation: "ideas_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      content_items_overview: {
        Row: {
          author_name: string | null
          captured_date: string | null
          content_type: string | null
          created_at: string | null
          has_embedding: boolean | null
          has_thumbnail: boolean | null
          id: string | null
          is_classified: boolean | null
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
          has_embedding?: never
          has_thumbnail?: never
          id?: string | null
          is_classified?: never
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
          has_embedding?: never
          has_thumbnail?: never
          id?: string | null
          is_classified?: never
          platform?: string | null
          primary_domain?: string | null
          primary_subtopic?: string | null
          source_domain?: string | null
          title?: string | null
        }
        Relationships: []
      }
      ideas_with_stats: {
        Row: {
          captured_date: string | null
          child_ideas_count: number | null
          content: string | null
          created_at: string | null
          id: string | null
          keywords_count: number | null
          parent_id: string | null
          primary_domain: string | null
          primary_subtopic: string | null
          priority: string | null
          related_ideas_count: number | null
          source_type: string | null
          status: string | null
          themes_count: number | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ideas_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ideas_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ideas_with_stats"
            referencedColumns: ["id"]
          },
        ]
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
      filter_by_keywords: {
        Args: { search_terms: string[] }
        Returns: string[]
      }
      find_idea_dependencies: {
        Args: { max_depth?: number; start_idea_id: string }
        Returns: {
          content: string
          dependency_depth: number
          idea_id: string
          relationship_type: string
          title: string
        }[]
      }
      find_similar_all: {
        Args: {
          limit_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          content: string
          id: string
          item_type: string
          primary_domain: string
          similarity: number
          source_table: string
          title: string
        }[]
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
      find_similar_ideas: {
        Args: {
          limit_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          content: string
          id: string
          primary_domain: string
          similarity: number
          source_type: string
          status: string
          title: string
        }[]
      }
      get_author_analysis: { Args: { p_author_name: string }; Returns: Json }
      get_capture_activity: {
        Args: Record<string, never>
        Returns: {
          day: string
          count: number
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
      get_domain_unread_counts: {
        Args: never
        Returns: {
          domain: string
          unread_count: number
        }[]
      }
      get_filter_counts: { Args: never; Returns: Json }
      get_idea_subtree: {
        Args: { root_idea_id: string }
        Returns: {
          content: string
          depth: number
          id: string
          parent_id: string
          primary_domain: string
          status: string
          title: string
        }[]
      }
      get_ingestion_timeline: {
        Args: { p_days?: number; p_granularity?: string }
        Returns: {
          item_count: number
          period: string
          platform: string
        }[]
      }
      get_item_projects: {
        Args: { p_item_id: string }
        Returns: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_archived: boolean | null
          name: string
          tana_node_id: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_pipeline_last_runs: {
        Args: never
        Returns: {
          last_duration_seconds: number
          last_error_message: string
          last_items_processed: number
          last_started_at: string
          last_status: string
          pipeline_name: string
        }[]
      }
      get_pipeline_stats: { Args: never; Returns: Json }
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
      get_quality_issues: {
        Args: {
          p_flag_type?: string
          p_limit?: number
          p_offset?: number
          p_resolved?: boolean
          p_severity?: string
          p_sort_by?: string
          p_sort_dir?: string
        }
        Returns: Json
      }
      get_reading_patterns: { Args: { p_days?: number }; Returns: Json }
      get_review_queue: {
        Args: {
          p_content_types?: string[]
          p_cursor?: string
          p_domains?: string[]
          p_limit?: number
          p_platforms?: string[]
        }
        Returns: {
          items: Json
          total_count: number
        }[]
      }
      get_source_freshness: {
        Args: never
        Returns: {
          last_30d: number
          last_7d: number
          last_ingested: string
          platform: string
          total_items: number
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
      get_user_tag_counts: { Args: never; Returns: Json }
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
