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
      _deleted_customers_backup: {
        Row: {
          customer_row: Json | null
          deleted_at: string | null
          flow_state_row: Json | null
          reason: string | null
        }
        Insert: {
          customer_row?: Json | null
          deleted_at?: string | null
          flow_state_row?: Json | null
          reason?: string | null
        }
        Update: {
          customer_row?: Json | null
          deleted_at?: string | null
          flow_state_row?: Json | null
          reason?: string | null
        }
        Relationships: []
      }
      academy_notes: {
        Row: {
          consultant_id: string
          content: string
          created_at: string
          id: string
          materials: Json
          note_date: string
          title: string
          updated_at: string
        }
        Insert: {
          consultant_id: string
          content?: string
          created_at?: string
          id?: string
          materials?: Json
          note_date?: string
          title?: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string
          content?: string
          created_at?: string
          id?: string
          materials?: Json
          note_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ad_account_managers: {
        Row: {
          consultant_id: string
          created_at: string
          created_by: string | null
          manager_user_id: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          created_by?: string | null
          manager_user_id: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          created_by?: string | null
          manager_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_managers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "ad_account_managers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_account_managers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_account_managers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      ad_bonus_tiers: {
        Row: {
          created_at: string
          label: string
          percent: number
          tier: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          label: string
          percent?: number
          tier: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          label?: string
          percent?: number
          tier?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ad_competitor_creatives: {
        Row: {
          active_days: number | null
          ad_archive_id: string | null
          advertiser: string
          angle: string | null
          created_at: string
          creative_format: string | null
          cta: string | null
          first_seen_at: string | null
          headline: string | null
          id: string
          image_url: string | null
          ingested_at: string
          last_seen_at: string | null
          page_id: string | null
          primary_text: string | null
          raw: Json | null
          region: string | null
          thumbnail_url: string | null
          video_url: string | null
        }
        Insert: {
          active_days?: number | null
          ad_archive_id?: string | null
          advertiser: string
          angle?: string | null
          created_at?: string
          creative_format?: string | null
          cta?: string | null
          first_seen_at?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          ingested_at?: string
          last_seen_at?: string | null
          page_id?: string | null
          primary_text?: string | null
          raw?: Json | null
          region?: string | null
          thumbnail_url?: string | null
          video_url?: string | null
        }
        Update: {
          active_days?: number | null
          ad_archive_id?: string | null
          advertiser?: string
          angle?: string | null
          created_at?: string
          creative_format?: string | null
          cta?: string | null
          first_seen_at?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          ingested_at?: string
          last_seen_at?: string | null
          page_id?: string | null
          primary_text?: string | null
          raw?: Json | null
          region?: string | null
          thumbnail_url?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      ad_creative_insights: {
        Row: {
          best_cpa_cents: number | null
          best_ctr_bps: number
          best_formats: Json
          best_image_briefs: Json
          best_image_traits: Json
          competitor_summary: string | null
          consultant_id: string
          created_at: string
          distribuidora: string | null
          id: string
          losing_patterns: Json
          sample_size: number
          summary: string | null
          updated_at: string
          winning_patterns: Json
        }
        Insert: {
          best_cpa_cents?: number | null
          best_ctr_bps?: number
          best_formats?: Json
          best_image_briefs?: Json
          best_image_traits?: Json
          competitor_summary?: string | null
          consultant_id: string
          created_at?: string
          distribuidora?: string | null
          id?: string
          losing_patterns?: Json
          sample_size?: number
          summary?: string | null
          updated_at?: string
          winning_patterns?: Json
        }
        Update: {
          best_cpa_cents?: number | null
          best_ctr_bps?: number
          best_formats?: Json
          best_image_briefs?: Json
          best_image_traits?: Json
          competitor_summary?: string | null
          consultant_id?: string
          created_at?: string
          distribuidora?: string | null
          id?: string
          losing_patterns?: Json
          sample_size?: number
          summary?: string | null
          updated_at?: string
          winning_patterns?: Json
        }
        Relationships: []
      }
      ad_creative_performance: {
        Row: {
          angle: string | null
          campaign_id: string
          clicks: number
          consultant_id: string
          creative_format: string | null
          evaluated_at: string
          fb_ad_id: string
          framework: string | null
          headline: string | null
          id: string
          image_brief: string | null
          impressions: number
          is_loser: boolean
          is_winner: boolean
          leads: number
          paused_by_ai_at: string | null
          primary_text: string | null
          registrations: number
          score: number
          spend_cents: number
        }
        Insert: {
          angle?: string | null
          campaign_id: string
          clicks?: number
          consultant_id: string
          creative_format?: string | null
          evaluated_at?: string
          fb_ad_id: string
          framework?: string | null
          headline?: string | null
          id?: string
          image_brief?: string | null
          impressions?: number
          is_loser?: boolean
          is_winner?: boolean
          leads?: number
          paused_by_ai_at?: string | null
          primary_text?: string | null
          registrations?: number
          score?: number
          spend_cents?: number
        }
        Update: {
          angle?: string | null
          campaign_id?: string
          clicks?: number
          consultant_id?: string
          creative_format?: string | null
          evaluated_at?: string
          fb_ad_id?: string
          framework?: string | null
          headline?: string | null
          id?: string
          image_brief?: string | null
          impressions?: number
          is_loser?: boolean
          is_winner?: boolean
          leads?: number
          paused_by_ai_at?: string | null
          primary_text?: string | null
          registrations?: number
          score?: number
          spend_cents?: number
        }
        Relationships: []
      }
      ad_generated_creatives: {
        Row: {
          angle: string | null
          badge_text: string | null
          brief_used: string | null
          composite_url: string | null
          consultant_id: string
          created_at: string
          format: string
          headline_used: string | null
          id: string
          image_url: string
          inspired_by_advertisers: string[] | null
          is_public: boolean
          overlay_layout: Json | null
          prompt_used: string | null
          qa_attempts: number | null
          qa_report: Json | null
          storage_path: string | null
          used_in_campaign_id: string | null
        }
        Insert: {
          angle?: string | null
          badge_text?: string | null
          brief_used?: string | null
          composite_url?: string | null
          consultant_id: string
          created_at?: string
          format: string
          headline_used?: string | null
          id?: string
          image_url: string
          inspired_by_advertisers?: string[] | null
          is_public?: boolean
          overlay_layout?: Json | null
          prompt_used?: string | null
          qa_attempts?: number | null
          qa_report?: Json | null
          storage_path?: string | null
          used_in_campaign_id?: string | null
        }
        Update: {
          angle?: string | null
          badge_text?: string | null
          brief_used?: string | null
          composite_url?: string | null
          consultant_id?: string
          created_at?: string
          format?: string
          headline_used?: string | null
          id?: string
          image_url?: string
          inspired_by_advertisers?: string[] | null
          is_public?: boolean
          overlay_layout?: Json | null
          prompt_used?: string | null
          qa_attempts?: number | null
          qa_report?: Json | null
          storage_path?: string | null
          used_in_campaign_id?: string | null
        }
        Relationships: []
      }
      ad_image_library: {
        Row: {
          consultant_id: string
          content_type: string | null
          created_at: string
          fb_image_hash: string | null
          fb_image_hash_synced_at: string | null
          file_size: number | null
          filename: string | null
          format: string
          height: number | null
          id: string
          last_used_at: string | null
          storage_path: string | null
          updated_at: string
          url: string
          usage_count: number
          width: number | null
        }
        Insert: {
          consultant_id: string
          content_type?: string | null
          created_at?: string
          fb_image_hash?: string | null
          fb_image_hash_synced_at?: string | null
          file_size?: number | null
          filename?: string | null
          format: string
          height?: number | null
          id?: string
          last_used_at?: string | null
          storage_path?: string | null
          updated_at?: string
          url: string
          usage_count?: number
          width?: number | null
        }
        Update: {
          consultant_id?: string
          content_type?: string | null
          created_at?: string
          fb_image_hash?: string | null
          fb_image_hash_synced_at?: string | null
          file_size?: number | null
          filename?: string | null
          format?: string
          height?: number | null
          id?: string
          last_used_at?: string | null
          storage_path?: string | null
          updated_at?: string
          url?: string
          usage_count?: number
          width?: number | null
        }
        Relationships: []
      }
      ad_image_validations: {
        Row: {
          created_at: string
          format: string
          id: string
          image_url: string
          validation: Json
        }
        Insert: {
          created_at?: string
          format: string
          id?: string
          image_url: string
          validation: Json
        }
        Update: {
          created_at?: string
          format?: string
          id?: string
          image_url?: string
          validation?: Json
        }
        Relationships: []
      }
      ad_playbooks: {
        Row: {
          consultant_id: string | null
          created_at: string
          generated_at: string
          id: string
          payload: Json
          scope: string
          source_metric: string | null
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          generated_at?: string
          id?: string
          payload: Json
          scope?: string
          source_metric?: string | null
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          generated_at?: string
          id?: string
          payload?: Json
          scope?: string
          source_metric?: string | null
        }
        Relationships: []
      }
      ad_recommendations: {
        Row: {
          action_label: string | null
          action_payload: Json | null
          applied_at: string | null
          consultant_id: string
          created_at: string
          dismissed_at: string | null
          id: string
          message: string
          severity: string
          title: string
          type: string
        }
        Insert: {
          action_label?: string | null
          action_payload?: Json | null
          applied_at?: string | null
          consultant_id: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          message: string
          severity?: string
          title: string
          type: string
        }
        Update: {
          action_label?: string | null
          action_payload?: Json | null
          applied_at?: string | null
          consultant_id?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          message?: string
          severity?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      ad_spend_daily: {
        Row: {
          campaigns: Json
          clicks: number
          consultant_id: string
          date: string
          id: string
          impressions: number
          leads: number
          spend_cents: number
          synced_at: string
        }
        Insert: {
          campaigns?: Json
          clicks?: number
          consultant_id: string
          date: string
          id?: string
          impressions?: number
          leads?: number
          spend_cents?: number
          synced_at?: string
        }
        Update: {
          campaigns?: Json
          clicks?: number
          consultant_id?: string
          date?: string
          id?: string
          impressions?: number
          leads?: number
          spend_cents?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_daily_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "ad_spend_daily_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_spend_daily_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_spend_daily_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      ad_template_usages: {
        Row: {
          campaign_id: string | null
          consultant_id: string
          created_at: string
          id: string
          template_id: string
        }
        Insert: {
          campaign_id?: string | null
          consultant_id: string
          created_at?: string
          id?: string
          template_id: string
        }
        Update: {
          campaign_id?: string | null
          consultant_id?: string
          created_at?: string
          id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_template_usages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "ad_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_templates: {
        Row: {
          age_max: number
          age_min: number
          avg_cpl_cents: number | null
          consultant_id: string | null
          created_at: string
          created_by: string | null
          creative_mode: string
          default_radius_km: number | null
          description: string | null
          description_text: string
          genders: string[]
          headline: string
          headline_variants: string[]
          id: string
          origin_template_id: string | null
          photos: Json
          primary_text: string
          primary_text_variants: string[]
          status: string
          suggested_daily_budget_cents: number
          target_cidades: string[]
          target_distribuidora_ids: string[]
          title: string
          updated_at: string
          usage_count: number
          video_thumb_url: string | null
          video_url: string | null
        }
        Insert: {
          age_max?: number
          age_min?: number
          avg_cpl_cents?: number | null
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          creative_mode?: string
          default_radius_km?: number | null
          description?: string | null
          description_text?: string
          genders?: string[]
          headline?: string
          headline_variants?: string[]
          id?: string
          origin_template_id?: string | null
          photos?: Json
          primary_text?: string
          primary_text_variants?: string[]
          status?: string
          suggested_daily_budget_cents?: number
          target_cidades?: string[]
          target_distribuidora_ids?: string[]
          title: string
          updated_at?: string
          usage_count?: number
          video_thumb_url?: string | null
          video_url?: string | null
        }
        Update: {
          age_max?: number
          age_min?: number
          avg_cpl_cents?: number | null
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          creative_mode?: string
          default_radius_km?: number | null
          description?: string | null
          description_text?: string
          genders?: string[]
          headline?: string
          headline_variants?: string[]
          id?: string
          origin_template_id?: string | null
          photos?: Json
          primary_text?: string
          primary_text_variants?: string[]
          status?: string
          suggested_daily_budget_cents?: number
          target_cidades?: string[]
          target_distribuidora_ids?: string[]
          title?: string
          updated_at?: string
          usage_count?: number
          video_thumb_url?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_templates_origin_template_id_fkey"
            columns: ["origin_template_id"]
            isOneToOne: false
            referencedRelation: "ad_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_video_library: {
        Row: {
          consultant_id: string
          content_type: string | null
          created_at: string
          duration_seconds: number | null
          fb_video_id: string | null
          fb_video_id_synced_at: string | null
          file_size: number | null
          filename: string | null
          height: number | null
          id: string
          last_used_at: string | null
          storage_path: string | null
          thumb_source: string
          thumb_url: string | null
          updated_at: string
          url: string
          usage_count: number
          width: number | null
        }
        Insert: {
          consultant_id: string
          content_type?: string | null
          created_at?: string
          duration_seconds?: number | null
          fb_video_id?: string | null
          fb_video_id_synced_at?: string | null
          file_size?: number | null
          filename?: string | null
          height?: number | null
          id?: string
          last_used_at?: string | null
          storage_path?: string | null
          thumb_source?: string
          thumb_url?: string | null
          updated_at?: string
          url: string
          usage_count?: number
          width?: number | null
        }
        Update: {
          consultant_id?: string
          content_type?: string | null
          created_at?: string
          duration_seconds?: number | null
          fb_video_id?: string | null
          fb_video_id_synced_at?: string | null
          file_size?: number | null
          filename?: string | null
          height?: number | null
          id?: string
          last_used_at?: string | null
          storage_path?: string | null
          thumb_source?: string
          thumb_url?: string | null
          updated_at?: string
          url?: string
          usage_count?: number
          width?: number | null
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      admin_setup_checklist: {
        Row: {
          done_at: string
          id: string
          item_key: string
          note: string | null
          user_id: string
        }
        Insert: {
          done_at?: string
          id?: string
          item_key: string
          note?: string | null
          user_id: string
        }
        Update: {
          done_at?: string
          id?: string
          item_key?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_agent_config: {
        Row: {
          consultant_id: string | null
          created_at: string
          enabled: boolean
          handoff_rules: Json
          id: string
          persona_name: string
          step_prompts: Json
          system_prompt: string | null
          tone: string
          typing_max_ms: number
          typing_min_ms: number
          updated_at: string
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          enabled?: boolean
          handoff_rules?: Json
          id?: string
          persona_name?: string
          step_prompts?: Json
          system_prompt?: string | null
          tone?: string
          typing_max_ms?: number
          typing_min_ms?: number
          updated_at?: string
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          enabled?: boolean
          handoff_rules?: Json
          id?: string
          persona_name?: string
          step_prompts?: Json
          system_prompt?: string | null
          tone?: string
          typing_max_ms?: number
          typing_min_ms?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_agent_logs: {
        Row: {
          consultant_id: string
          created_at: string
          customer_id: string | null
          error: string | null
          handoff: boolean
          handoff_reason: string | null
          id: string
          latency_ms: number | null
          llm_output: Json | null
          media_sent_id: string | null
          phone: string | null
          step_after: string | null
          step_before: string | null
          user_input: string | null
          user_input_kind: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          error?: string | null
          handoff?: boolean
          handoff_reason?: string | null
          id?: string
          latency_ms?: number | null
          llm_output?: Json | null
          media_sent_id?: string | null
          phone?: string | null
          step_after?: string | null
          step_before?: string | null
          user_input?: string | null
          user_input_kind?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          error?: string | null
          handoff?: boolean
          handoff_reason?: string | null
          id?: string
          latency_ms?: number | null
          llm_output?: Json | null
          media_sent_id?: string | null
          phone?: string | null
          step_after?: string | null
          step_before?: string | null
          user_input?: string | null
          user_input_kind?: string | null
        }
        Relationships: []
      }
      ai_agent_slots: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          fallback_text: string | null
          is_testing: boolean
          label: string
          min_interval_minutes: number
          position: number
          slot_key: string
          trigger_hint: string | null
          updated_at: string
          version: number
          video_label: string | null
          video_storage_path: string | null
          video_url: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          fallback_text?: string | null
          is_testing?: boolean
          label: string
          min_interval_minutes?: number
          position?: number
          slot_key: string
          trigger_hint?: string | null
          updated_at?: string
          version?: number
          video_label?: string | null
          video_storage_path?: string | null
          video_url?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          fallback_text?: string | null
          is_testing?: boolean
          label?: string
          min_interval_minutes?: number
          position?: number
          slot_key?: string
          trigger_hint?: string | null
          updated_at?: string
          version?: number
          video_label?: string | null
          video_storage_path?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      ai_cooldown_state: {
        Row: {
          cooldown_key: string
          reason: string | null
          until_at: string
        }
        Insert: {
          cooldown_key: string
          reason?: string | null
          until_at: string
        }
        Update: {
          cooldown_key?: string
          reason?: string | null
          until_at?: string
        }
        Relationships: []
      }
      ai_costs: {
        Row: {
          calls: number
          consultant_id: string | null
          created_at: string
          day: string
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          phase: string
          updated_at: string
          usd_est: number
        }
        Insert: {
          calls?: number
          consultant_id?: string | null
          created_at?: string
          day?: string
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          phase: string
          updated_at?: string
          usd_est?: number
        }
        Update: {
          calls?: number
          consultant_id?: string | null
          created_at?: string
          day?: string
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          phase?: string
          updated_at?: string
          usd_est?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_costs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "ai_costs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_costs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_costs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      ai_decisions: {
        Row: {
          ai_output: Json | null
          channel: string | null
          confidence: number | null
          consultant_id: string
          created_at: string
          customer_id: string | null
          feedback: Json | null
          id: string
          intent_detected: string | null
          latency_ms: number | null
          media_sent_id: string | null
          model: string | null
          phase: string
          reasoning: string | null
          reply_sent: string | null
          source: string | null
          step_after: string | null
          step_before: string | null
          suppressed: boolean
          tool_called: string
          trace_id: string | null
          user_input: string | null
        }
        Insert: {
          ai_output?: Json | null
          channel?: string | null
          confidence?: number | null
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          feedback?: Json | null
          id?: string
          intent_detected?: string | null
          latency_ms?: number | null
          media_sent_id?: string | null
          model?: string | null
          phase: string
          reasoning?: string | null
          reply_sent?: string | null
          source?: string | null
          step_after?: string | null
          step_before?: string | null
          suppressed?: boolean
          tool_called: string
          trace_id?: string | null
          user_input?: string | null
        }
        Update: {
          ai_output?: Json | null
          channel?: string | null
          confidence?: number | null
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          feedback?: Json | null
          id?: string
          intent_detected?: string | null
          latency_ms?: number | null
          media_sent_id?: string | null
          model?: string | null
          phase?: string
          reasoning?: string | null
          reply_sent?: string | null
          source?: string | null
          step_after?: string | null
          step_before?: string | null
          suppressed?: boolean
          tool_called?: string
          trace_id?: string | null
          user_input?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_decisions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_sections: {
        Row: {
          consultant_id: string | null
          content: string
          created_at: string
          embedding: string | null
          embedding_updated_at: string | null
          id: string
          is_active: boolean
          is_critical: boolean
          keywords: string[]
          persona: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          consultant_id?: string | null
          content: string
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          is_active?: boolean
          is_critical?: boolean
          keywords?: string[]
          persona?: string
          position?: number
          title: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string | null
          content?: string
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          is_active?: boolean
          is_critical?: boolean
          keywords?: string[]
          persona?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_learned_patterns: {
        Row: {
          bad_examples: Json
          consultant_id: string
          created_at: string
          good_examples: Json
          id: string
          intent: string
          sample_count: number
          updated_at: string
        }
        Insert: {
          bad_examples?: Json
          consultant_id: string
          created_at?: string
          good_examples?: Json
          id?: string
          intent: string
          sample_count?: number
          updated_at?: string
        }
        Update: {
          bad_examples?: Json
          consultant_id?: string
          created_at?: string
          good_examples?: Json
          id?: string
          intent?: string
          sample_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_learning_digest: {
        Row: {
          created_at: string
          digest_date: string
          id: string
          metrics: Json
          sent_at: string | null
          sent_to: string | null
          summary_text: string | null
        }
        Insert: {
          created_at?: string
          digest_date: string
          id?: string
          metrics?: Json
          sent_at?: string | null
          sent_to?: string | null
          summary_text?: string | null
        }
        Update: {
          created_at?: string
          digest_date?: string
          id?: string
          metrics?: Json
          sent_at?: string | null
          sent_to?: string | null
          summary_text?: string | null
        }
        Relationships: []
      }
      ai_media_library: {
        Row: {
          active: boolean
          consultant_id: string | null
          content_hash: string | null
          created_at: string
          delay_before_ms: number
          duration_sec: number | null
          final_size_bytes: number | null
          id: string
          intent_tags: string[]
          is_draft: boolean
          is_primary_explainer: boolean
          is_public: boolean
          kind: string
          label: string
          original_size_bytes: number | null
          priority: number
          reply_count: number
          send_order: number
          sent_count: number
          slot_key: string | null
          step_tags: string[]
          storage_path: string | null
          text_content: string | null
          transcript: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          active?: boolean
          consultant_id?: string | null
          content_hash?: string | null
          created_at?: string
          delay_before_ms?: number
          duration_sec?: number | null
          final_size_bytes?: number | null
          id?: string
          intent_tags?: string[]
          is_draft?: boolean
          is_primary_explainer?: boolean
          is_public?: boolean
          kind: string
          label: string
          original_size_bytes?: number | null
          priority?: number
          reply_count?: number
          send_order?: number
          sent_count?: number
          slot_key?: string | null
          step_tags?: string[]
          storage_path?: string | null
          text_content?: string | null
          transcript?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          active?: boolean
          consultant_id?: string | null
          content_hash?: string | null
          created_at?: string
          delay_before_ms?: number
          duration_sec?: number | null
          final_size_bytes?: number | null
          id?: string
          intent_tags?: string[]
          is_draft?: boolean
          is_primary_explainer?: boolean
          is_public?: boolean
          kind?: string
          label?: string
          original_size_bytes?: number | null
          priority?: number
          reply_count?: number
          send_order?: number
          sent_count?: number
          slot_key?: string | null
          step_tags?: string[]
          storage_path?: string | null
          text_content?: string | null
          transcript?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      ai_slot_dispatch_log: {
        Row: {
          confirmed_at: string | null
          consultant_id: string
          customer_id: string | null
          dispatch_status: string
          id: string
          media_id: string | null
          reply_within_min: number | null
          reservation_id: string | null
          reserved_at: string | null
          sent_at: string
          slot_key: string
          variant: string
        }
        Insert: {
          confirmed_at?: string | null
          consultant_id: string
          customer_id?: string | null
          dispatch_status?: string
          id?: string
          media_id?: string | null
          reply_within_min?: number | null
          reservation_id?: string | null
          reserved_at?: string | null
          sent_at?: string
          slot_key: string
          variant: string
        }
        Update: {
          confirmed_at?: string | null
          consultant_id?: string
          customer_id?: string | null
          dispatch_status?: string
          id?: string
          media_id?: string | null
          reply_within_min?: number | null
          reservation_id?: string | null
          reserved_at?: string | null
          sent_at?: string
          slot_key?: string
          variant?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          consultant_id: string | null
          cost_estimate_cents: number | null
          created_at: string
          customer_id: string | null
          degraded: boolean | null
          function_name: string
          id: string
          latency_ms: number | null
          metadata: Json | null
          model: string
          outcome: string | null
          thinking_tokens: number | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          consultant_id?: string | null
          cost_estimate_cents?: number | null
          created_at?: string
          customer_id?: string | null
          degraded?: boolean | null
          function_name: string
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          model: string
          outcome?: string | null
          thinking_tokens?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          consultant_id?: string | null
          cost_estimate_cents?: number | null
          created_at?: string
          customer_id?: string | null
          degraded?: boolean | null
          function_name?: string
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          model?: string
          outcome?: string | null
          thinking_tokens?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: []
      }
      ai_winning_conversations: {
        Row: {
          consultant_id: string | null
          created_at: string
          created_by: string | null
          embedding: string | null
          etapa: string
          id: string
          outcome: string | null
          snippet: string
          updated_at: string
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          etapa: string
          id?: string
          outcome?: string | null
          snippet: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          etapa?: string
          id?: string
          outcome?: string | null
          snippet?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_winning_conversations_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "ai_winning_conversations_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_winning_conversations_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_winning_conversations_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      app_settings: {
        Row: {
          bot_engine_production_mode: boolean
          bot_global_enabled: boolean
          cadence_allowed_ddds: Json
          cadence_audience_mode: string
          cadence_engine_enabled: boolean
          cadence_window: Json | null
          devtools_blocked: boolean
          fluxo_b_persona: string | null
          id: string
          minio_alert_threshold_pct: number
          resolver_strict_mode: boolean
          retarget_enabled: boolean
          super_admin_instance_name: string | null
          super_admin_phone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bot_engine_production_mode?: boolean
          bot_global_enabled?: boolean
          cadence_allowed_ddds?: Json
          cadence_audience_mode?: string
          cadence_engine_enabled?: boolean
          cadence_window?: Json | null
          devtools_blocked?: boolean
          fluxo_b_persona?: string | null
          id?: string
          minio_alert_threshold_pct?: number
          resolver_strict_mode?: boolean
          retarget_enabled?: boolean
          super_admin_instance_name?: string | null
          super_admin_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bot_engine_production_mode?: boolean
          bot_global_enabled?: boolean
          cadence_allowed_ddds?: Json
          cadence_audience_mode?: string
          cadence_engine_enabled?: boolean
          cadence_window?: Json | null
          devtools_blocked?: boolean
          fluxo_b_persona?: string | null
          id?: string
          minio_alert_threshold_pct?: number
          resolver_strict_mode?: boolean
          retarget_enabled?: boolean
          super_admin_instance_name?: string | null
          super_admin_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      audio_library: {
        Row: {
          audio_hash: string
          audio_url: string
          audio_url_vinheta: string | null
          city: string
          consultant_id: string
          created_at: string
          id: string
          is_public: boolean
          kind: string
          place_name: string
          play_count: number
          script_text: string
          street: string
          time_slot: string
          updated_at: string
          voice_id: string | null
        }
        Insert: {
          audio_hash?: string
          audio_url: string
          audio_url_vinheta?: string | null
          city?: string
          consultant_id: string
          created_at?: string
          id?: string
          is_public?: boolean
          kind: string
          place_name?: string
          play_count?: number
          script_text?: string
          street?: string
          time_slot?: string
          updated_at?: string
          voice_id?: string | null
        }
        Update: {
          audio_hash?: string
          audio_url?: string
          audio_url_vinheta?: string | null
          city?: string
          consultant_id?: string
          created_at?: string
          id?: string
          is_public?: boolean
          kind?: string
          place_name?: string
          play_count?: number
          script_text?: string
          street?: string
          time_slot?: string
          updated_at?: string
          voice_id?: string | null
        }
        Relationships: []
      }
      automation_dead_letter: {
        Row: {
          attempts: number
          customer_id: string | null
          effect_id: string | null
          engine_key: string
          first_failed_at: string
          id: string
          last_failed_at: string
          logical_key: string | null
          meta: Json
          reason_code: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          attempts?: number
          customer_id?: string | null
          effect_id?: string | null
          engine_key: string
          first_failed_at?: string
          id?: string
          last_failed_at?: string
          logical_key?: string | null
          meta?: Json
          reason_code: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          customer_id?: string | null
          effect_id?: string | null
          engine_key?: string
          first_failed_at?: string
          id?: string
          last_failed_at?: string
          logical_key?: string | null
          meta?: Json
          reason_code?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          auth_reason: string | null
          claimed: number
          dead_lettered: number
          engine_key: string
          error_code: string | null
          failed: number
          finished_at: string | null
          heartbeat_at: string
          id: string
          meta: Json
          mode: string
          scanned: number
          sent: number
          skipped: number
          started_at: string
          status: string
          trigger_kind: string
          unknown: number
          worker_id: string | null
        }
        Insert: {
          auth_reason?: string | null
          claimed?: number
          dead_lettered?: number
          engine_key: string
          error_code?: string | null
          failed?: number
          finished_at?: string | null
          heartbeat_at?: string
          id?: string
          meta?: Json
          mode?: string
          scanned?: number
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          trigger_kind?: string
          unknown?: number
          worker_id?: string | null
        }
        Update: {
          auth_reason?: string | null
          claimed?: number
          dead_lettered?: number
          engine_key?: string
          error_code?: string | null
          failed?: number
          finished_at?: string | null
          heartbeat_at?: string
          id?: string
          meta?: Json
          mode?: string
          scanned?: number
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          trigger_kind?: string
          unknown?: number
          worker_id?: string | null
        }
        Relationships: []
      }
      automation_skip_log: {
        Row: {
          created_at: string
          id: string
          key: string
          meta: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          meta?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          meta?: Json
        }
        Relationships: []
      }
      automation_toggles: {
        Row: {
          category: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          key: string
          label: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key: string
          label: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      bot_flow_audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          consultant_id: string | null
          created_at: string
          flow_id: string
          id: string
          source: string
          step_id: string | null
          summary: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          consultant_id?: string | null
          created_at?: string
          flow_id: string
          id?: string
          source?: string
          step_id?: string | null
          summary?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          consultant_id?: string | null
          created_at?: string
          flow_id?: string
          id?: string
          source?: string
          step_id?: string | null
          summary?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bot_flow_qa: {
        Row: {
          created_at: string
          embedding: string | null
          embedding_updated_at: string | null
          flow_id: string
          id: string
          intent_name: string
          is_closing: boolean
          is_opening: boolean
          is_public: boolean
          position: number
          text_response: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          flow_id: string
          id?: string
          intent_name?: string
          is_closing?: boolean
          is_opening?: boolean
          is_public?: boolean
          position?: number
          text_response?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          flow_id?: string
          id?: string
          intent_name?: string
          is_closing?: boolean
          is_opening?: boolean
          is_public?: boolean
          position?: number
          text_response?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_flow_qa_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "bot_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_flow_qa_media: {
        Row: {
          created_at: string
          id: string
          media_id: string | null
          media_kind: string
          position: number
          qa_id: string
          slot_key: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          media_id?: string | null
          media_kind: string
          position?: number
          qa_id: string
          slot_key?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          media_id?: string | null
          media_kind?: string
          position?: number
          qa_id?: string
          slot_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_flow_qa_media_qa_id_fkey"
            columns: ["qa_id"]
            isOneToOne: false
            referencedRelation: "bot_flow_qa"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_flow_qa_triggers: {
        Row: {
          created_at: string
          id: string
          phrase: string
          qa_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          phrase: string
          qa_id: string
        }
        Update: {
          created_at?: string
          id?: string
          phrase?: string
          qa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_flow_qa_triggers_qa_id_fkey"
            columns: ["qa_id"]
            isOneToOne: false
            referencedRelation: "bot_flow_qa"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_flow_steps: {
        Row: {
          auto_detect_doc_type: boolean
          business_hour_end: string | null
          business_hour_start: string | null
          captures: Json
          condition_text: string | null
          created_at: string
          fallback: Json
          flow_id: string
          icon: string
          id: string
          is_active: boolean
          layout: Json | null
          media_order: Json
          message_text: string | null
          pause_on_holiday: boolean
          pause_on_weekend: boolean
          personalize_name: boolean
          persuasive_text: string | null
          position: number
          respect_business_hours: boolean
          slot_key: string | null
          step_key: string | null
          step_type: string
          summary: string | null
          text_delay_ms: number
          title: string | null
          transitions: Json
          transitions_backup_pre_v2: Json | null
          updated_at: string
          voice_audio_clip_id: string | null
          wait_for: string
          wait_seconds: number
        }
        Insert: {
          auto_detect_doc_type?: boolean
          business_hour_end?: string | null
          business_hour_start?: string | null
          captures?: Json
          condition_text?: string | null
          created_at?: string
          fallback?: Json
          flow_id: string
          icon?: string
          id?: string
          is_active?: boolean
          layout?: Json | null
          media_order?: Json
          message_text?: string | null
          pause_on_holiday?: boolean
          pause_on_weekend?: boolean
          personalize_name?: boolean
          persuasive_text?: string | null
          position?: number
          respect_business_hours?: boolean
          slot_key?: string | null
          step_key?: string | null
          step_type: string
          summary?: string | null
          text_delay_ms?: number
          title?: string | null
          transitions?: Json
          transitions_backup_pre_v2?: Json | null
          updated_at?: string
          voice_audio_clip_id?: string | null
          wait_for?: string
          wait_seconds?: number
        }
        Update: {
          auto_detect_doc_type?: boolean
          business_hour_end?: string | null
          business_hour_start?: string | null
          captures?: Json
          condition_text?: string | null
          created_at?: string
          fallback?: Json
          flow_id?: string
          icon?: string
          id?: string
          is_active?: boolean
          layout?: Json | null
          media_order?: Json
          message_text?: string | null
          pause_on_holiday?: boolean
          pause_on_weekend?: boolean
          personalize_name?: boolean
          persuasive_text?: string | null
          position?: number
          respect_business_hours?: boolean
          slot_key?: string | null
          step_key?: string | null
          step_type?: string
          summary?: string | null
          text_delay_ms?: number
          title?: string | null
          transitions?: Json
          transitions_backup_pre_v2?: Json | null
          updated_at?: string
          voice_audio_clip_id?: string | null
          wait_for?: string
          wait_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "bot_flow_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "bot_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_flow_steps_voice_audio_clip_id_fkey"
            columns: ["voice_audio_clip_id"]
            isOneToOne: false
            referencedRelation: "voice_audio_clips"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_flows: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          strict_mode: boolean
          sync_mode: string
          updated_at: string
          variant: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          strict_mode?: boolean
          sync_mode?: string
          updated_at?: string
          variant?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          strict_mode?: boolean
          sync_mode?: string
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      bot_handoff_alerts: {
        Row: {
          alert_type: string
          consultant_id: string
          created_at: string
          customer_id: string | null
          id: string
          metadata: Json | null
          phone: string | null
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          user_message: string | null
        }
        Insert: {
          alert_type?: string
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          metadata?: Json | null
          phone?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          user_message?: string | null
        }
        Update: {
          alert_type?: string
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          metadata?: Json | null
          phone?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          user_message?: string | null
        }
        Relationships: []
      }
      bot_message_ab_results: {
        Row: {
          advanced_count: number
          consultant_id: string | null
          created_at: string
          id: string
          last_sent_at: string | null
          replied_count: number
          sent_count: number
          step_key: string
          template_key: string
          updated_at: string
          variant: string
        }
        Insert: {
          advanced_count?: number
          consultant_id?: string | null
          created_at?: string
          id?: string
          last_sent_at?: string | null
          replied_count?: number
          sent_count?: number
          step_key: string
          template_key: string
          updated_at?: string
          variant?: string
        }
        Update: {
          advanced_count?: number
          consultant_id?: string | null
          created_at?: string
          id?: string
          last_sent_at?: string | null
          replied_count?: number
          sent_count?: number
          step_key?: string
          template_key?: string
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      bot_messages: {
        Row: {
          active: boolean
          created_at: string
          id: string
          step_key: string
          template_key: string
          text: string
          updated_at: string
          variant: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          step_key: string
          template_key: string
          text: string
          updated_at?: string
          variant?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          step_key?: string
          template_key?: string
          text?: string
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      bot_step_transitions: {
        Row: {
          confidence: number | null
          consultant_id: string | null
          created_at: string
          customer_id: string | null
          duration_ms: number | null
          from_step: string | null
          id: string
          intent: string | null
          phone: string | null
          reason: string | null
          to_step: string
        }
        Insert: {
          confidence?: number | null
          consultant_id?: string | null
          created_at?: string
          customer_id?: string | null
          duration_ms?: number | null
          from_step?: string | null
          id?: string
          intent?: string | null
          phone?: string | null
          reason?: string | null
          to_step: string
        }
        Update: {
          confidence?: number | null
          consultant_id?: string | null
          created_at?: string
          customer_id?: string | null
          duration_ms?: number | null
          from_step?: string | null
          id?: string
          intent?: string | null
          phone?: string | null
          reason?: string | null
          to_step?: string
        }
        Relationships: []
      }
      bot_test_outbound: {
        Row: {
          content: string | null
          conversation_step_after: string | null
          conversation_step_before: string | null
          created_at: string
          direction: string
          id: string
          kind: string
          latency_ms: number | null
          run_id: string
          turn: number
        }
        Insert: {
          content?: string | null
          conversation_step_after?: string | null
          conversation_step_before?: string | null
          created_at?: string
          direction: string
          id?: string
          kind: string
          latency_ms?: number | null
          run_id: string
          turn: number
        }
        Update: {
          content?: string | null
          conversation_step_after?: string | null
          conversation_step_before?: string | null
          created_at?: string
          direction?: string
          id?: string
          kind?: string
          latency_ms?: number | null
          run_id?: string
          turn?: number
        }
        Relationships: [
          {
            foreignKeyName: "bot_test_outbound_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "bot_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_test_runs: {
        Row: {
          consultant_id: string | null
          created_by: string | null
          customer_id: string | null
          finished_at: string | null
          id: string
          scenario: string
          started_at: string
          status: string
          summary: Json | null
        }
        Insert: {
          consultant_id?: string | null
          created_by?: string | null
          customer_id?: string | null
          finished_at?: string | null
          id?: string
          scenario?: string
          started_at?: string
          status?: string
          summary?: Json | null
        }
        Update: {
          consultant_id?: string | null
          created_by?: string | null
          customer_id?: string | null
          finished_at?: string | null
          id?: string
          scenario?: string
          started_at?: string
          status?: string
          summary?: Json | null
        }
        Relationships: []
      }
      br_municipios: {
        Row: {
          created_at: string
          ibge_code: number
          name: string
          name_normalized: string
          uf: string
        }
        Insert: {
          created_at?: string
          ibge_code: number
          name: string
          name_normalized: string
          uf: string
        }
        Update: {
          created_at?: string
          ibge_code?: number
          name?: string
          name_normalized?: string
          uf?: string
        }
        Relationships: []
      }
      bulk_campaign_targets: {
        Row: {
          campaign_id: string
          claim_attempts: number
          claimed_at: string | null
          created_at: string
          error: string | null
          final_message: string | null
          id: string
          name: string | null
          phone: string
          sent_at: string | null
          status: string
          vars: Json
        }
        Insert: {
          campaign_id: string
          claim_attempts?: number
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          final_message?: string | null
          id?: string
          name?: string | null
          phone: string
          sent_at?: string | null
          status?: string
          vars?: Json
        }
        Update: {
          campaign_id?: string
          claim_attempts?: number
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          final_message?: string | null
          id?: string
          name?: string | null
          phone?: string
          sent_at?: string | null
          status?: string
          vars?: Json
        }
        Relationships: [
          {
            foreignKeyName: "bulk_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "bulk_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_campaigns: {
        Row: {
          config: Json
          consultant_id: string
          created_at: string
          failed: number
          finished_at: string | null
          id: string
          media_filename: string | null
          media_type: string | null
          media_url: string | null
          message_text: string | null
          name: string
          scheduled_at: string | null
          sent: number
          started_at: string | null
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          config?: Json
          consultant_id: string
          created_at?: string
          failed?: number
          finished_at?: string | null
          id?: string
          media_filename?: string | null
          media_type?: string | null
          media_url?: string | null
          message_text?: string | null
          name?: string
          scheduled_at?: string | null
          sent?: number
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          consultant_id?: string
          created_at?: string
          failed?: number
          finished_at?: string | null
          id?: string
          media_filename?: string | null
          media_type?: string | null
          media_url?: string | null
          message_text?: string | null
          name?: string
          scheduled_at?: string | null
          sent?: number
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      cadence_action_log: {
        Row: {
          channel: Database["public"]["Enums"]["cadence_channel"]
          consultant_id: string | null
          cost_cents: number
          created_at: string
          customer_id: string
          detail: Json
          id: string
          provider_ref: string | null
          stage: Database["public"]["Enums"]["cadence_stage"]
          status: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["cadence_channel"]
          consultant_id?: string | null
          cost_cents?: number
          created_at?: string
          customer_id: string
          detail?: Json
          id?: string
          provider_ref?: string | null
          stage: Database["public"]["Enums"]["cadence_stage"]
          status?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["cadence_channel"]
          consultant_id?: string | null
          cost_cents?: number
          created_at?: string
          customer_id?: string
          detail?: Json
          id?: string
          provider_ref?: string | null
          stage?: Database["public"]["Enums"]["cadence_stage"]
          status?: string
        }
        Relationships: []
      }
      cadence_stage_config: {
        Row: {
          buttons: Json | null
          consultant_id: string | null
          created_at: string
          delay_hours: number
          enabled: boolean
          id: string
          max_per_lead: number
          media_type: string | null
          media_url: string | null
          message_text: string | null
          personalize_name: boolean
          stage: string
          template_updated_at: string | null
          template_version: number
          updated_at: string
          velip_audio_id: string | null
          voice_audio_clip_id: string | null
          window_days: number[] | null
          window_end_hour: number | null
          window_start_hour: number | null
        }
        Insert: {
          buttons?: Json | null
          consultant_id?: string | null
          created_at?: string
          delay_hours?: number
          enabled?: boolean
          id?: string
          max_per_lead?: number
          media_type?: string | null
          media_url?: string | null
          message_text?: string | null
          personalize_name?: boolean
          stage: string
          template_updated_at?: string | null
          template_version?: number
          updated_at?: string
          velip_audio_id?: string | null
          voice_audio_clip_id?: string | null
          window_days?: number[] | null
          window_end_hour?: number | null
          window_start_hour?: number | null
        }
        Update: {
          buttons?: Json | null
          consultant_id?: string | null
          created_at?: string
          delay_hours?: number
          enabled?: boolean
          id?: string
          max_per_lead?: number
          media_type?: string | null
          media_url?: string | null
          message_text?: string | null
          personalize_name?: boolean
          stage?: string
          template_updated_at?: string | null
          template_version?: number
          updated_at?: string
          velip_audio_id?: string | null
          voice_audio_clip_id?: string | null
          window_days?: number[] | null
          window_end_hour?: number | null
          window_start_hour?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cadence_stage_config_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "cadence_stage_config_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_stage_config_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_stage_config_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "cadence_stage_config_voice_audio_clip_id_fkey"
            columns: ["voice_audio_clip_id"]
            isOneToOne: false
            referencedRelation: "voice_audio_clips"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_theme_config: {
        Row: {
          consultant_id: string | null
          created_at: string
          enabled: boolean
          id: string
          sms_text: string
          theme_id: string
          updated_at: string
          wa_text: string
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          sms_text?: string
          theme_id: string
          updated_at?: string
          wa_text?: string
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          sms_text?: string
          theme_id?: string
          updated_at?: string
          wa_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_theme_config_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "cadence_theme_config_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_theme_config_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_theme_config_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      campaign_match_log: {
        Row: {
          campaign_id: string | null
          created_at: string
          customer_id: string
          id: number
          message_sample: string | null
          method: string
          rodizio_outcome: string | null
          similarity: number | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          customer_id: string
          id?: number
          message_sample?: string | null
          method: string
          rodizio_outcome?: string | null
          similarity?: number | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          customer_id?: string
          id?: number
          message_sample?: string | null
          method?: string
          rodizio_outcome?: string | null
          similarity?: number | null
        }
        Relationships: []
      }
      campaign_protocol_sequence: {
        Row: {
          last_seq: number
          updated_at: string
          year: number
        }
        Insert: {
          last_seq?: number
          updated_at?: string
          year: number
        }
        Update: {
          last_seq?: number
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      capture_achievements: {
        Row: {
          badge_key: string
          consultant_id: string
          earned_at: string
          id: string
          metadata: Json
        }
        Insert: {
          badge_key: string
          consultant_id: string
          earned_at?: string
          id?: string
          metadata?: Json
        }
        Update: {
          badge_key?: string
          consultant_id?: string
          earned_at?: string
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      capture_diagnostics: {
        Row: {
          actions: Json
          bottlenecks: Json
          computed_at: string
          consultant_id: string | null
          created_at: string
          id: string
          kpis: Json
          model_used: string | null
          sample_size: number
          scope: string
          summary: string | null
          winners: Json
        }
        Insert: {
          actions?: Json
          bottlenecks?: Json
          computed_at?: string
          consultant_id?: string | null
          created_at?: string
          id?: string
          kpis?: Json
          model_used?: string | null
          sample_size?: number
          scope?: string
          summary?: string | null
          winners?: Json
        }
        Update: {
          actions?: Json
          bottlenecks?: Json
          computed_at?: string
          consultant_id?: string | null
          created_at?: string
          id?: string
          kpis?: Json
          model_used?: string | null
          sample_size?: number
          scope?: string
          summary?: string | null
          winners?: Json
        }
        Relationships: [
          {
            foreignKeyName: "capture_diagnostics_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "capture_diagnostics_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capture_diagnostics_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capture_diagnostics_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      capture_field_events: {
        Row: {
          confirmed_at: string
          consultant_id: string
          customer_id: string
          field: string
          id: string
          source: string
        }
        Insert: {
          confirmed_at?: string
          consultant_id: string
          customer_id: string
          field: string
          id?: string
          source?: string
        }
        Update: {
          confirmed_at?: string
          consultant_id?: string
          customer_id?: string
          field?: string
          id?: string
          source?: string
        }
        Relationships: []
      }
      capture_field_suggestions: {
        Row: {
          confidence: number
          consultant_id: string
          created_at: string
          customer_id: string
          field_name: string
          id: string
          resolved_at: string | null
          source_message_id: string | null
          status: string
          suggested_value: string
        }
        Insert: {
          confidence?: number
          consultant_id: string
          created_at?: string
          customer_id: string
          field_name: string
          id?: string
          resolved_at?: string | null
          source_message_id?: string | null
          status?: string
          suggested_value: string
        }
        Update: {
          confidence?: number
          consultant_id?: string
          created_at?: string
          customer_id?: string
          field_name?: string
          id?: string
          resolved_at?: string | null
          source_message_id?: string | null
          status?: string
          suggested_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_field_suggestions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      capture_scoreboard: {
        Row: {
          avg_minutes: number
          consultant_id: string
          created_at: string
          date: string
          id: string
          registrations: number
          streak: number
          updated_at: string
        }
        Insert: {
          avg_minutes?: number
          consultant_id: string
          created_at?: string
          date?: string
          id?: string
          registrations?: number
          streak?: number
          updated_at?: string
        }
        Update: {
          avg_minutes?: number
          consultant_id?: string
          created_at?: string
          date?: string
          id?: string
          registrations?: number
          streak?: number
          updated_at?: string
        }
        Relationships: []
      }
      captured_leads: {
        Row: {
          channel: string
          city: string | null
          cnpj: string | null
          company_name: string | null
          consent_at: string | null
          consent_source: string | null
          consent_text: string | null
          consultant_id: string
          created_at: string
          ctwa_clid: string | null
          customer_id: string | null
          dedup_key: string | null
          email: string | null
          full_name: string | null
          id: string
          person_type: string
          phone: string | null
          pj_data: Json
          product_interest: string | null
          raw_payload: Json
          sale_id: string | null
          source_campaign_id: string | null
          status: string
          uf: string | null
          updated_at: string
        }
        Insert: {
          channel?: string
          city?: string | null
          cnpj?: string | null
          company_name?: string | null
          consent_at?: string | null
          consent_source?: string | null
          consent_text?: string | null
          consultant_id: string
          created_at?: string
          ctwa_clid?: string | null
          customer_id?: string | null
          dedup_key?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          person_type?: string
          phone?: string | null
          pj_data?: Json
          product_interest?: string | null
          raw_payload?: Json
          sale_id?: string | null
          source_campaign_id?: string | null
          status?: string
          uf?: string | null
          updated_at?: string
        }
        Update: {
          channel?: string
          city?: string | null
          cnpj?: string | null
          company_name?: string | null
          consent_at?: string | null
          consent_source?: string | null
          consent_text?: string | null
          consultant_id?: string
          created_at?: string
          ctwa_clid?: string | null
          customer_id?: string | null
          dedup_key?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          person_type?: string
          phone?: string | null
          pj_data?: Json
          product_interest?: string | null
          raw_payload?: Json
          sale_id?: string | null
          source_campaign_id?: string | null
          status?: string
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "captured_leads_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "captured_leads_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_leads_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_leads_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "captured_leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_leads_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_leads_source_campaign_id_fkey"
            columns: ["source_campaign_id"]
            isOneToOne: false
            referencedRelation: "facebook_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_ad_settings: {
        Row: {
          age_max: number
          age_min: number
          brain_config: Json
          cities: Json
          consultant_id: string
          created_at: string
          display_name: string | null
          distribuidora_default: string | null
          updated_at: string
          whatsapp_destination_number: string | null
          whatsapp_last_verified_at: string | null
          whatsapp_phone_number_display: string | null
          whatsapp_phone_number_id: string | null
        }
        Insert: {
          age_max?: number
          age_min?: number
          brain_config?: Json
          cities?: Json
          consultant_id: string
          created_at?: string
          display_name?: string | null
          distribuidora_default?: string | null
          updated_at?: string
          whatsapp_destination_number?: string | null
          whatsapp_last_verified_at?: string | null
          whatsapp_phone_number_display?: string | null
          whatsapp_phone_number_id?: string | null
        }
        Update: {
          age_max?: number
          age_min?: number
          brain_config?: Json
          cities?: Json
          consultant_id?: string
          created_at?: string
          display_name?: string | null
          distribuidora_default?: string | null
          updated_at?: string
          whatsapp_destination_number?: string | null
          whatsapp_last_verified_at?: string | null
          whatsapp_phone_number_display?: string | null
          whatsapp_phone_number_id?: string | null
        }
        Relationships: []
      }
      consultant_commission_settings: {
        Row: {
          cadastro_igreen_ids: string[]
          consultant_id: string
          count_mode: string
          created_at: string
          graduacao: string
          updated_at: string
        }
        Insert: {
          cadastro_igreen_ids?: string[]
          consultant_id: string
          count_mode?: string
          created_at?: string
          graduacao?: string
          updated_at?: string
        }
        Update: {
          cadastro_igreen_ids?: string[]
          consultant_id?: string
          count_mode?: string
          created_at?: string
          graduacao?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_commission_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultant_commission_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_commission_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_commission_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      consultant_entrada_rules: {
        Row: {
          ativo: boolean
          consultant_id: string
          created_at: string
          dias_diferido: number
          distribuidora: string
          entrada_total_pct: number
          id: string
          min_pessoas: number
          pct_diferido: number
          pct_imediato: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          consultant_id: string
          created_at?: string
          dias_diferido?: number
          distribuidora: string
          entrada_total_pct?: number
          id?: string
          min_pessoas: number
          pct_diferido?: number
          pct_imediato?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          consultant_id?: string
          created_at?: string
          dias_diferido?: number
          distribuidora?: string
          entrada_total_pct?: number
          id?: string
          min_pessoas?: number
          pct_diferido?: number
          pct_imediato?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_entrada_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultant_entrada_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_entrada_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_entrada_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      consultant_message_templates: {
        Row: {
          audio_url: string | null
          category: string
          consultant_id: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          label: string
          template_key: string
          text_content: string
          typing_delay_ms: number
          updated_at: string
          variables: Json
        }
        Insert: {
          audio_url?: string | null
          category?: string
          consultant_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label: string
          template_key: string
          text_content?: string
          typing_delay_ms?: number
          updated_at?: string
          variables?: Json
        }
        Update: {
          audio_url?: string | null
          category?: string
          consultant_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
          template_key?: string
          text_content?: string
          typing_delay_ms?: number
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      consultant_network: {
        Row: {
          celular: string | null
          cidade: string | null
          codigo_igreen: string
          consultant_id: string
          created_at: string
          gl_qualificados: number | null
          gp_qualificados: number | null
          graduacao: string | null
          id: string
          mes_ref: string | null
          nivel: number | null
          nome: string | null
          patrocinador_codigo: string | null
          raw_json: Json | null
          source: string
          uf: string | null
          updated_at: string
        }
        Insert: {
          celular?: string | null
          cidade?: string | null
          codigo_igreen: string
          consultant_id: string
          created_at?: string
          gl_qualificados?: number | null
          gp_qualificados?: number | null
          graduacao?: string | null
          id?: string
          mes_ref?: string | null
          nivel?: number | null
          nome?: string | null
          patrocinador_codigo?: string | null
          raw_json?: Json | null
          source?: string
          uf?: string | null
          updated_at?: string
        }
        Update: {
          celular?: string | null
          cidade?: string | null
          codigo_igreen?: string
          consultant_id?: string
          created_at?: string
          gl_qualificados?: number | null
          gp_qualificados?: number | null
          graduacao?: string | null
          id?: string
          mes_ref?: string | null
          nivel?: number | null
          nome?: string | null
          patrocinador_codigo?: string | null
          raw_json?: Json | null
          source?: string
          uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      consultant_pos_venda_media: {
        Row: {
          audio_media_id: string | null
          configured_at: string | null
          consultant_id: string
          created_at: string
          id: string
          image_media_id: string | null
          send_order: string[]
          stage: string
          text_content: string | null
          updated_at: string
          use_default: boolean
          video_media_id: string | null
        }
        Insert: {
          audio_media_id?: string | null
          configured_at?: string | null
          consultant_id: string
          created_at?: string
          id?: string
          image_media_id?: string | null
          send_order?: string[]
          stage: string
          text_content?: string | null
          updated_at?: string
          use_default?: boolean
          video_media_id?: string | null
        }
        Update: {
          audio_media_id?: string | null
          configured_at?: string | null
          consultant_id?: string
          created_at?: string
          id?: string
          image_media_id?: string | null
          send_order?: string[]
          stage?: string
          text_content?: string | null
          updated_at?: string
          use_default?: boolean
          video_media_id?: string | null
        }
        Relationships: []
      }
      consultant_presence: {
        Row: {
          consultant_id: string
          last_seen_at: string
          updated_at: string
        }
        Insert: {
          consultant_id: string
          last_seen_at?: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string
          last_seen_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      consultant_wallet: {
        Row: {
          auto_pause_at_cents: number
          balance_cents: number
          consultant_id: string
          created_at: string
          debt_cents: number
          last_synced_at: string | null
          total_spent_cents: number
          total_topped_up_cents: number
          updated_at: string
        }
        Insert: {
          auto_pause_at_cents?: number
          balance_cents?: number
          consultant_id: string
          created_at?: string
          debt_cents?: number
          last_synced_at?: string | null
          total_spent_cents?: number
          total_topped_up_cents?: number
          updated_at?: string
        }
        Update: {
          auto_pause_at_cents?: number
          balance_cents?: number
          consultant_id?: string
          created_at?: string
          debt_cents?: number
          last_synced_at?: string | null
          total_spent_cents?: number
          total_topped_up_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      consultants: {
        Row: {
          ab_test_counter: number
          ab_test_enabled: boolean
          active_variants: string[]
          ai_persona: string | null
          ai_persona_fluxo_b: string | null
          ai_persona_fluxo_b_cascade_enabled: boolean | null
          ai_persona_fluxo_b_temperature: number | null
          ai_profile: string
          ai_provider_pref: string
          approved: boolean | null
          assistant_name: string | null
          bot_engine_mode: string
          cadastro_url: string
          cerebro_ativo: string
          club_cadastro_url: string | null
          conversational_flow_enabled: boolean
          created_at: string | null
          display_name: string | null
          facebook_label_id: string | null
          facebook_pixel_id: string | null
          flow_engine_v3: string
          flow_reliability_v2: string
          flow_step_media_order: Json
          gender: string | null
          google_analytics_id: string | null
          id: string
          igreen_consultor_id: string | null
          igreen_credential_checked_at: string | null
          igreen_credential_error: string | null
          igreen_credential_status: string | null
          igreen_id: string | null
          igreen_portal_email: string | null
          igreen_portal_password: string | null
          licenciada_cadastro_url: string | null
          license: string
          name: string
          notification_phone: string | null
          phone: string
          phone_verified_at: string | null
          photo_url: string | null
          portal_kind: string
          referred_by: string | null
          solar_3d_enabled: boolean
          solar_public_widget_enabled: boolean
          timezone: string | null
          use_engine_v3: boolean
        }
        Insert: {
          ab_test_counter?: number
          ab_test_enabled?: boolean
          active_variants?: string[]
          ai_persona?: string | null
          ai_persona_fluxo_b?: string | null
          ai_persona_fluxo_b_cascade_enabled?: boolean | null
          ai_persona_fluxo_b_temperature?: number | null
          ai_profile?: string
          ai_provider_pref?: string
          approved?: boolean | null
          assistant_name?: string | null
          bot_engine_mode?: string
          cadastro_url: string
          cerebro_ativo?: string
          club_cadastro_url?: string | null
          conversational_flow_enabled?: boolean
          created_at?: string | null
          display_name?: string | null
          facebook_label_id?: string | null
          facebook_pixel_id?: string | null
          flow_engine_v3?: string
          flow_reliability_v2?: string
          flow_step_media_order?: Json
          gender?: string | null
          google_analytics_id?: string | null
          id: string
          igreen_consultor_id?: string | null
          igreen_credential_checked_at?: string | null
          igreen_credential_error?: string | null
          igreen_credential_status?: string | null
          igreen_id?: string | null
          igreen_portal_email?: string | null
          igreen_portal_password?: string | null
          licenciada_cadastro_url?: string | null
          license: string
          name: string
          notification_phone?: string | null
          phone: string
          phone_verified_at?: string | null
          photo_url?: string | null
          portal_kind?: string
          referred_by?: string | null
          solar_3d_enabled?: boolean
          solar_public_widget_enabled?: boolean
          timezone?: string | null
          use_engine_v3?: boolean
        }
        Update: {
          ab_test_counter?: number
          ab_test_enabled?: boolean
          active_variants?: string[]
          ai_persona?: string | null
          ai_persona_fluxo_b?: string | null
          ai_persona_fluxo_b_cascade_enabled?: boolean | null
          ai_persona_fluxo_b_temperature?: number | null
          ai_profile?: string
          ai_provider_pref?: string
          approved?: boolean | null
          assistant_name?: string | null
          bot_engine_mode?: string
          cadastro_url?: string
          cerebro_ativo?: string
          club_cadastro_url?: string | null
          conversational_flow_enabled?: boolean
          created_at?: string | null
          display_name?: string | null
          facebook_label_id?: string | null
          facebook_pixel_id?: string | null
          flow_engine_v3?: string
          flow_reliability_v2?: string
          flow_step_media_order?: Json
          gender?: string | null
          google_analytics_id?: string | null
          id?: string
          igreen_consultor_id?: string | null
          igreen_credential_checked_at?: string | null
          igreen_credential_error?: string | null
          igreen_credential_status?: string | null
          igreen_id?: string | null
          igreen_portal_email?: string | null
          igreen_portal_password?: string | null
          licenciada_cadastro_url?: string | null
          license?: string
          name?: string
          notification_phone?: string | null
          phone?: string
          phone_verified_at?: string | null
          photo_url?: string | null
          portal_kind?: string
          referred_by?: string | null
          solar_3d_enabled?: boolean
          solar_public_widget_enabled?: boolean
          timezone?: string | null
          use_engine_v3?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "consultants_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultants_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultants_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultants_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      contact_suppression_log: {
        Row: {
          actor_id: string | null
          channel: string
          consultant_id: string
          created_at: string
          customer_id: string | null
          id: string
          notes: string | null
          phone: string
          reason: string
        }
        Insert: {
          actor_id?: string | null
          channel?: string
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          notes?: string | null
          phone: string
          reason?: string
        }
        Update: {
          actor_id?: string | null
          channel?: string
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          notes?: string | null
          phone?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_suppression_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          conversation_step: string | null
          created_at: string
          customer_id: string
          delivery_checked_at: string | null
          delivery_error: string | null
          delivery_status: string | null
          external_message_id: string | null
          id: string
          media_id: string | null
          message_direction: string
          message_text: string | null
          message_text_hash: string | null
          message_type: string | null
          origin: string | null
          sent_by: string | null
          slot_key: string | null
        }
        Insert: {
          conversation_step?: string | null
          created_at?: string
          customer_id: string
          delivery_checked_at?: string | null
          delivery_error?: string | null
          delivery_status?: string | null
          external_message_id?: string | null
          id?: string
          media_id?: string | null
          message_direction: string
          message_text?: string | null
          message_text_hash?: string | null
          message_type?: string | null
          origin?: string | null
          sent_by?: string | null
          slot_key?: string | null
        }
        Update: {
          conversation_step?: string | null
          created_at?: string
          customer_id?: string
          delivery_checked_at?: string | null
          delivery_error?: string | null
          delivery_status?: string | null
          external_message_id?: string | null
          id?: string
          media_id?: string | null
          message_direction?: string
          message_text?: string | null
          message_text_hash?: string | null
          message_type?: string | null
          origin?: string | null
          sent_by?: string | null
          slot_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_phrase_catalog: {
        Row: {
          category: string
          consultant_id: string | null
          conversation_step: string | null
          conversion_chance: number
          created_at: string
          id: string
          is_system: boolean
          message_text: string
          next_action: string
          priority: number
          shortcut: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          trigger_keywords: string[]
          updated_at: string
        }
        Insert: {
          category: string
          consultant_id?: string | null
          conversation_step?: string | null
          conversion_chance?: number
          created_at?: string
          id?: string
          is_system?: boolean
          message_text: string
          next_action: string
          priority?: number
          shortcut: string
          temperature?: Database["public"]["Enums"]["lead_temperature"] | null
          trigger_keywords?: string[]
          updated_at?: string
        }
        Update: {
          category?: string
          consultant_id?: string | null
          conversation_step?: string | null
          conversion_chance?: number
          created_at?: string
          id?: string
          is_system?: boolean
          message_text?: string
          next_action?: string
          priority?: number
          shortcut?: string
          temperature?: Database["public"]["Enums"]["lead_temperature"] | null
          trigger_keywords?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_phrase_catalog_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "conversion_phrase_catalog_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_phrase_catalog_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_phrase_catalog_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      crm_auto_message_log: {
        Row: {
          consultant_id: string
          created_at: string
          customer_name: string | null
          deal_id: string
          id: string
          message_preview: string | null
          remote_jid: string | null
          stage_key: string
          status: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          customer_name?: string | null
          deal_id: string
          id?: string
          message_preview?: string | null
          remote_jid?: string | null
          stage_key: string
          status?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          customer_name?: string | null
          deal_id?: string
          id?: string
          message_preview?: string | null
          remote_jid?: string | null
          stage_key?: string
          status?: string
        }
        Relationships: []
      }
      crm_deals: {
        Row: {
          approved_at: string | null
          consultant_id: string
          created_at: string
          customer_id: string | null
          deal_origin: string | null
          id: string
          notes: string | null
          rejected_at: string | null
          rejection_reason: string | null
          remote_jid: string | null
          stage: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          deal_origin?: string | null
          id?: string
          notes?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          remote_jid?: string | null
          stage?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          deal_origin?: string | null
          id?: string
          notes?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          remote_jid?: string | null
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_page_events: {
        Row: {
          created_at: string
          device_type: string | null
          event_target: string | null
          event_type: string
          id: string
          referrer: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          created_at?: string
          device_type?: string | null
          event_target?: string | null
          event_type?: string
          id?: string
          referrer?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          created_at?: string
          device_type?: string | null
          event_target?: string | null
          event_type?: string
          id?: string
          referrer?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      ctwa_clid_mapping: {
        Row: {
          campaign_id: string
          created_at: string
          ctwa_clid: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          ctwa_clid: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          ctwa_clid?: string
        }
        Relationships: [
          {
            foreignKeyName: "ctwa_clid_mapping_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "facebook_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      ctwa_referral_probe_log: {
        Row: {
          consultant_id: string | null
          created_at: string
          customer_id: string | null
          extracted: Json | null
          had_ctwa_phrase: boolean
          id: string
          matched_paths: string[]
          payload: Json
          source: string
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          customer_id?: string | null
          extracted?: Json | null
          had_ctwa_phrase?: boolean
          id?: string
          matched_paths?: string[]
          payload: Json
          source: string
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          customer_id?: string | null
          extracted?: Json | null
          had_ctwa_phrase?: boolean
          id?: string
          matched_paths?: string[]
          payload?: Json
          source?: string
        }
        Relationships: []
      }
      customer_auto_message_log: {
        Row: {
          consultant_id: string
          created_at: string
          customer_id: string
          customer_name: string | null
          id: string
          message_preview: string | null
          remote_jid: string | null
          stage_key: string
          status: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          customer_id: string
          customer_name?: string | null
          id?: string
          message_preview?: string | null
          remote_jid?: string | null
          stage_key: string
          status?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          customer_id?: string
          customer_name?: string | null
          id?: string
          message_preview?: string | null
          remote_jid?: string | null
          stage_key?: string
          status?: string
        }
        Relationships: []
      }
      customer_flow_state: {
        Row: {
          ai_questions_this_step: number
          assigned_human_id: string | null
          current_step_id: string | null
          customer_id: string
          entered_step_at: string
          expires_at: string | null
          flow_id: string | null
          last_inbound_at: string | null
          last_outbound_at: string | null
          last_outbound_content_hash: string | null
          pause_reason: string | null
          retries: number
          status: string
          updated_at: string
        }
        Insert: {
          ai_questions_this_step?: number
          assigned_human_id?: string | null
          current_step_id?: string | null
          customer_id: string
          entered_step_at?: string
          expires_at?: string | null
          flow_id?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          last_outbound_content_hash?: string | null
          pause_reason?: string | null
          retries?: number
          status?: string
          updated_at?: string
        }
        Update: {
          ai_questions_this_step?: number
          assigned_human_id?: string | null
          current_step_id?: string | null
          customer_id?: string
          entered_step_at?: string
          expires_at?: string | null
          flow_id?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          last_outbound_content_hash?: string | null
          pause_reason?: string | null
          retries?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_flow_state_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_memory: {
        Row: {
          active: boolean
          category: string
          confidence: number
          consultant_id: string
          created_at: string
          customer_id: string
          expires_at: string | null
          id: string
          key: string
          last_confirmed_at: string
          metadata: Json | null
          source: string
          updated_at: string
          value: string
        }
        Insert: {
          active?: boolean
          category: string
          confidence?: number
          consultant_id: string
          created_at?: string
          customer_id: string
          expires_at?: string | null
          id?: string
          key: string
          last_confirmed_at?: string
          metadata?: Json | null
          source?: string
          updated_at?: string
          value: string
        }
        Update: {
          active?: boolean
          category?: string
          confidence?: number
          consultant_id?: string
          created_at?: string
          customer_id?: string
          expires_at?: string | null
          id?: string
          key?: string
          last_confirmed_at?: string
          metadata?: Json | null
          source?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      customer_processing_lock: {
        Row: {
          customer_id: string
          lock_token: string
          locked_at: string
          locked_until: string
        }
        Insert: {
          customer_id: string
          lock_token: string
          locked_at?: string
          locked_until: string
        }
        Update: {
          customer_id?: string
          lock_token?: string
          locked_at?: string
          locked_until?: string
        }
        Relationships: []
      }
      customer_tags: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          remote_jid: string
          tag_color: string
          tag_name: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          remote_jid: string
          tag_color?: string
          tag_name: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          remote_jid?: string
          tag_color?: string
          tag_name?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          ai_followups_count: number
          ai_last_rescue_at: string | null
          ai_rescue_count: number
          andamento_igreen: string | null
          assigned_consultant_id: string | null
          assigned_human_id: string | null
          assinatura_cliente: string | null
          assinatura_cliente_status: string | null
          assinatura_igreen: string | null
          assinatura_igreen_status: string | null
          attendance_auto_close_at: string | null
          attendance_auto_close_source: string | null
          attendance_ended_at: string | null
          attendance_rating: number | null
          attendance_rating_at: string | null
          attendance_rating_requested_at: string | null
          bill_base64: string | null
          bill_data_confirmation_by: string | null
          bill_data_confirmed_at: string | null
          bill_holder_name: string | null
          bill_message_id: string | null
          bill_owner_relationship: string | null
          bill_requested_at: string | null
          bot_force_enabled: boolean
          bot_paused: boolean
          bot_paused_at: string | null
          bot_paused_reason: string | null
          bot_paused_until: string | null
          bot_processing_until: string | null
          capture_closed_at: string | null
          capture_closed_by: string | null
          capture_mode: string
          capture_started_at: string | null
          cashback: string | null
          cashback_igreen: string | null
          cep: string | null
          chat_cleared_at: string | null
          club_created_at: string | null
          club_dry_run: boolean | null
          club_error: string | null
          club_error_kind: string | null
          club_payload: Json | null
          club_response: Json | null
          club_status: string | null
          club_updated_at: string | null
          commission_rate: number | null
          concessionaria: string | null
          consultant_id: string | null
          conta_pdf_protegida: boolean | null
          contaunica: boolean | null
          contaunica_answered: boolean
          conversation_step: string | null
          conversation_summary: string | null
          conversational_flow_enabled: boolean | null
          converted_at: string | null
          cpf: string | null
          created_at: string
          ctwa_clid: string | null
          custom_step_retries: number
          custom_step_retries_step: string | null
          customer_origin: string
          customer_referred_by_consultant_id: string | null
          customer_referred_by_name: string | null
          customer_referred_by_phone: string | null
          data_ativo: string | null
          data_ativo_igreen: string | null
          data_cadastro: string | null
          data_cadastro_igreen: string | null
          data_injecao_igreen: string | null
          data_nascimento: string | null
          data_nascimento_iso: string | null
          data_validado: string | null
          data_validado_igreen: string | null
          debitos_aberto: boolean | null
          desconto_cliente: number | null
          detour_count: number
          devolutiva: string | null
          distribuidora: string | null
          do_not_contact: boolean
          doc_data_confirmation_by: string | null
          doc_data_confirmed_at: string | null
          doc_holder_name: string | null
          document_back_base64: string | null
          document_back_url: string | null
          document_front_base64: string | null
          document_front_url: string | null
          document_type: string | null
          document_uploaded: boolean | null
          document_verify_at: string | null
          document_verify_status: string | null
          electricity_bill_photo_url: string | null
          electricity_bill_value: number | null
          electricity_boleto_photo_url: string | null
          email: string | null
          error_message: string | null
          facial_confirmed_at: string | null
          facial_link_sent_at: string | null
          finalized_at: string | null
          finalized_by: string | null
          flow_variant: string | null
          fluxo_b_state: Json
          fluxo_b_variant: string
          followup_count: number
          followup_hook: string | null
          fornecedora: string | null
          historico_completo_at: string | null
          id: string
          igreen_account_id: string | null
          igreen_code: string | null
          igreen_link: string | null
          intent_signals: Json | null
          is_converted: boolean
          is_sandbox: boolean
          is_test_lead: boolean
          last_bot_interaction_at: string | null
          last_bot_reply_at: string | null
          last_custom_prompt_at: string | null
          last_enriched_at: string | null
          last_followup_at: string | null
          last_handoff_notified_at: string | null
          last_inbound_media_at: string | null
          last_inbound_media_kind: string | null
          last_inbound_media_message_id: string | null
          last_inbound_media_mime: string | null
          last_inbound_media_url: string | null
          last_new_lead_notified_at: string | null
          last_otp_dispatch_at: string | null
          last_otp_dispatch_error: string | null
          last_partner_notified_at: string | null
          last_portal_dispatch_at: string | null
          last_portal_dispatch_error: string | null
          last_rescue_at: string | null
          last_rule_fire_at: string | null
          last_rule_id: string | null
          last_step_advanced_at: string | null
          lead_source: Json | null
          lead_source_detail: Json | null
          link_assinatura: string | null
          link_facial: string | null
          link_facial_sent_at: string | null
          logindistribuidora: string | null
          manual_override_reactivate: boolean
          manual_review_at: string | null
          manual_review_reason: string | null
          media_consumo: number | null
          media_message_id: string | null
          media_storage: string | null
          meta_retargeting_synced_at: string | null
          name: string | null
          name_ask_sent_at: string | null
          name_mismatch_acknowledged_at: string | null
          name_mismatch_flag: boolean
          name_mismatch_reason: string | null
          name_source: string | null
          needs_manual_review: boolean
          next_followup_at: string | null
          next_rescue_allowed_at: string | null
          nivel_licenciado: string | null
          nome_mae: string | null
          nome_pai: string | null
          nudge_sent_at: string | null
          num_cliente_distribuidora: string | null
          numero_instalacao: string | null
          observacao: string | null
          observacao_igreen: string | null
          ocr_confianca: number | null
          ocr_consumo_original: number | null
          ocr_consumo_rejeitado: boolean | null
          ocr_conta_attempts: number
          ocr_doc_attempts: number
          ocr_done: boolean
          ocr_review_decided_at: string | null
          ocr_review_decided_by: string | null
          ocr_review_pending: string | null
          ocr_review_started_at: string | null
          orgao_expedidor: string | null
          origin_channel: string | null
          origin_consultant_id: string | null
          origin_instance_name: string | null
          origin_recovery: string | null
          otp_code: string | null
          otp_pending_replay: boolean
          otp_received_at: string | null
          otp_status: string | null
          otp_status_checked_at: string | null
          otp_test_phone: string | null
          otp_validated_at: string | null
          pain_point: string | null
          pending_flow_switch: string | null
          pending_inbound_at: string | null
          pending_inbound_message_id: string | null
          pending_snoozed_until: string | null
          phone_contact_confirmed: boolean
          phone_landline: string | null
          phone_whatsapp: string
          pj_jsonb: Json | null
          portal_idconsultor_override: number | null
          portal_last_retry_at: string | null
          portal_retry_count: number
          portal_submitted_at: string | null
          portal2_celular_alt: string | null
          portal2_contract_link: string | null
          portal2_correction_attempts: Json
          portal2_created_at: string | null
          portal2_error: string | null
          portal2_error_kind: string | null
          portal2_extraction_mode: string | null
          portal2_idcliente: number | null
          portal2_idsolcontratovalidacao: number | null
          portal2_ocr_bill_result: Json | null
          portal2_ocr_doc_result: Json | null
          portal2_otp_sent_at: string | null
          portal2_otp_validated_at: string | null
          portal2_status: string | null
          pos_venda_approved_at: string | null
          pos_venda_invalid: boolean
          pos_venda_manual: boolean
          pos_venda_pending_stage: string | null
          pos_venda_reason: string | null
          pos_venda_stage: string | null
          possui_placas: boolean | null
          possui_procurador: boolean | null
          previous_conversation_step: string | null
          procurador_jsonb: Json | null
          qualification_score: number | null
          referral_detected_at: string | null
          referral_keyword_matched: string | null
          referral_partner_id: string | null
          registered_by_igreen_id: string | null
          registered_by_name: string | null
          rescue_attempts: number
          rg: string | null
          sales_phase: string | null
          senha_pdf: string | null
          senhadistribuidora: string | null
          signature_summary: Json | null
          situacao_igreen: string | null
          source_ad_id: string | null
          source_campaign_id: string | null
          source_ctwa_clid: string | null
          source_referral: Json | null
          status: string
          status_financeiro: string | null
          summary_updated_at: string | null
          terms_accepted_at: string | null
          tipo_produto: string
          tracking_protocol: string | null
          transferir_titularidade: boolean | null
          transferir_titularidade_answered: boolean
          updated_at: string
          variant_id: string | null
          welcome_sent_at: string | null
          whatsapp_chat_id: string | null
          whatsapp_chat_id_checked_at: string | null
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          ai_followups_count?: number
          ai_last_rescue_at?: string | null
          ai_rescue_count?: number
          andamento_igreen?: string | null
          assigned_consultant_id?: string | null
          assigned_human_id?: string | null
          assinatura_cliente?: string | null
          assinatura_cliente_status?: string | null
          assinatura_igreen?: string | null
          assinatura_igreen_status?: string | null
          attendance_auto_close_at?: string | null
          attendance_auto_close_source?: string | null
          attendance_ended_at?: string | null
          attendance_rating?: number | null
          attendance_rating_at?: string | null
          attendance_rating_requested_at?: string | null
          bill_base64?: string | null
          bill_data_confirmation_by?: string | null
          bill_data_confirmed_at?: string | null
          bill_holder_name?: string | null
          bill_message_id?: string | null
          bill_owner_relationship?: string | null
          bill_requested_at?: string | null
          bot_force_enabled?: boolean
          bot_paused?: boolean
          bot_paused_at?: string | null
          bot_paused_reason?: string | null
          bot_paused_until?: string | null
          bot_processing_until?: string | null
          capture_closed_at?: string | null
          capture_closed_by?: string | null
          capture_mode?: string
          capture_started_at?: string | null
          cashback?: string | null
          cashback_igreen?: string | null
          cep?: string | null
          chat_cleared_at?: string | null
          club_created_at?: string | null
          club_dry_run?: boolean | null
          club_error?: string | null
          club_error_kind?: string | null
          club_payload?: Json | null
          club_response?: Json | null
          club_status?: string | null
          club_updated_at?: string | null
          commission_rate?: number | null
          concessionaria?: string | null
          consultant_id?: string | null
          conta_pdf_protegida?: boolean | null
          contaunica?: boolean | null
          contaunica_answered?: boolean
          conversation_step?: string | null
          conversation_summary?: string | null
          conversational_flow_enabled?: boolean | null
          converted_at?: string | null
          cpf?: string | null
          created_at?: string
          ctwa_clid?: string | null
          custom_step_retries?: number
          custom_step_retries_step?: string | null
          customer_origin?: string
          customer_referred_by_consultant_id?: string | null
          customer_referred_by_name?: string | null
          customer_referred_by_phone?: string | null
          data_ativo?: string | null
          data_ativo_igreen?: string | null
          data_cadastro?: string | null
          data_cadastro_igreen?: string | null
          data_injecao_igreen?: string | null
          data_nascimento?: string | null
          data_nascimento_iso?: string | null
          data_validado?: string | null
          data_validado_igreen?: string | null
          debitos_aberto?: boolean | null
          desconto_cliente?: number | null
          detour_count?: number
          devolutiva?: string | null
          distribuidora?: string | null
          do_not_contact?: boolean
          doc_data_confirmation_by?: string | null
          doc_data_confirmed_at?: string | null
          doc_holder_name?: string | null
          document_back_base64?: string | null
          document_back_url?: string | null
          document_front_base64?: string | null
          document_front_url?: string | null
          document_type?: string | null
          document_uploaded?: boolean | null
          document_verify_at?: string | null
          document_verify_status?: string | null
          electricity_bill_photo_url?: string | null
          electricity_bill_value?: number | null
          electricity_boleto_photo_url?: string | null
          email?: string | null
          error_message?: string | null
          facial_confirmed_at?: string | null
          facial_link_sent_at?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          flow_variant?: string | null
          fluxo_b_state?: Json
          fluxo_b_variant?: string
          followup_count?: number
          followup_hook?: string | null
          fornecedora?: string | null
          historico_completo_at?: string | null
          id?: string
          igreen_account_id?: string | null
          igreen_code?: string | null
          igreen_link?: string | null
          intent_signals?: Json | null
          is_converted?: boolean
          is_sandbox?: boolean
          is_test_lead?: boolean
          last_bot_interaction_at?: string | null
          last_bot_reply_at?: string | null
          last_custom_prompt_at?: string | null
          last_enriched_at?: string | null
          last_followup_at?: string | null
          last_handoff_notified_at?: string | null
          last_inbound_media_at?: string | null
          last_inbound_media_kind?: string | null
          last_inbound_media_message_id?: string | null
          last_inbound_media_mime?: string | null
          last_inbound_media_url?: string | null
          last_new_lead_notified_at?: string | null
          last_otp_dispatch_at?: string | null
          last_otp_dispatch_error?: string | null
          last_partner_notified_at?: string | null
          last_portal_dispatch_at?: string | null
          last_portal_dispatch_error?: string | null
          last_rescue_at?: string | null
          last_rule_fire_at?: string | null
          last_rule_id?: string | null
          last_step_advanced_at?: string | null
          lead_source?: Json | null
          lead_source_detail?: Json | null
          link_assinatura?: string | null
          link_facial?: string | null
          link_facial_sent_at?: string | null
          logindistribuidora?: string | null
          manual_override_reactivate?: boolean
          manual_review_at?: string | null
          manual_review_reason?: string | null
          media_consumo?: number | null
          media_message_id?: string | null
          media_storage?: string | null
          meta_retargeting_synced_at?: string | null
          name?: string | null
          name_ask_sent_at?: string | null
          name_mismatch_acknowledged_at?: string | null
          name_mismatch_flag?: boolean
          name_mismatch_reason?: string | null
          name_source?: string | null
          needs_manual_review?: boolean
          next_followup_at?: string | null
          next_rescue_allowed_at?: string | null
          nivel_licenciado?: string | null
          nome_mae?: string | null
          nome_pai?: string | null
          nudge_sent_at?: string | null
          num_cliente_distribuidora?: string | null
          numero_instalacao?: string | null
          observacao?: string | null
          observacao_igreen?: string | null
          ocr_confianca?: number | null
          ocr_consumo_original?: number | null
          ocr_consumo_rejeitado?: boolean | null
          ocr_conta_attempts?: number
          ocr_doc_attempts?: number
          ocr_done?: boolean
          ocr_review_decided_at?: string | null
          ocr_review_decided_by?: string | null
          ocr_review_pending?: string | null
          ocr_review_started_at?: string | null
          orgao_expedidor?: string | null
          origin_channel?: string | null
          origin_consultant_id?: string | null
          origin_instance_name?: string | null
          origin_recovery?: string | null
          otp_code?: string | null
          otp_pending_replay?: boolean
          otp_received_at?: string | null
          otp_status?: string | null
          otp_status_checked_at?: string | null
          otp_test_phone?: string | null
          otp_validated_at?: string | null
          pain_point?: string | null
          pending_flow_switch?: string | null
          pending_inbound_at?: string | null
          pending_inbound_message_id?: string | null
          pending_snoozed_until?: string | null
          phone_contact_confirmed?: boolean
          phone_landline?: string | null
          phone_whatsapp: string
          pj_jsonb?: Json | null
          portal_idconsultor_override?: number | null
          portal_last_retry_at?: string | null
          portal_retry_count?: number
          portal_submitted_at?: string | null
          portal2_celular_alt?: string | null
          portal2_contract_link?: string | null
          portal2_correction_attempts?: Json
          portal2_created_at?: string | null
          portal2_error?: string | null
          portal2_error_kind?: string | null
          portal2_extraction_mode?: string | null
          portal2_idcliente?: number | null
          portal2_idsolcontratovalidacao?: number | null
          portal2_ocr_bill_result?: Json | null
          portal2_ocr_doc_result?: Json | null
          portal2_otp_sent_at?: string | null
          portal2_otp_validated_at?: string | null
          portal2_status?: string | null
          pos_venda_approved_at?: string | null
          pos_venda_invalid?: boolean
          pos_venda_manual?: boolean
          pos_venda_pending_stage?: string | null
          pos_venda_reason?: string | null
          pos_venda_stage?: string | null
          possui_placas?: boolean | null
          possui_procurador?: boolean | null
          previous_conversation_step?: string | null
          procurador_jsonb?: Json | null
          qualification_score?: number | null
          referral_detected_at?: string | null
          referral_keyword_matched?: string | null
          referral_partner_id?: string | null
          registered_by_igreen_id?: string | null
          registered_by_name?: string | null
          rescue_attempts?: number
          rg?: string | null
          sales_phase?: string | null
          senha_pdf?: string | null
          senhadistribuidora?: string | null
          signature_summary?: Json | null
          situacao_igreen?: string | null
          source_ad_id?: string | null
          source_campaign_id?: string | null
          source_ctwa_clid?: string | null
          source_referral?: Json | null
          status?: string
          status_financeiro?: string | null
          summary_updated_at?: string | null
          terms_accepted_at?: string | null
          tipo_produto?: string
          tracking_protocol?: string | null
          transferir_titularidade?: boolean | null
          transferir_titularidade_answered?: boolean
          updated_at?: string
          variant_id?: string | null
          welcome_sent_at?: string | null
          whatsapp_chat_id?: string | null
          whatsapp_chat_id_checked_at?: string | null
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          ai_followups_count?: number
          ai_last_rescue_at?: string | null
          ai_rescue_count?: number
          andamento_igreen?: string | null
          assigned_consultant_id?: string | null
          assigned_human_id?: string | null
          assinatura_cliente?: string | null
          assinatura_cliente_status?: string | null
          assinatura_igreen?: string | null
          assinatura_igreen_status?: string | null
          attendance_auto_close_at?: string | null
          attendance_auto_close_source?: string | null
          attendance_ended_at?: string | null
          attendance_rating?: number | null
          attendance_rating_at?: string | null
          attendance_rating_requested_at?: string | null
          bill_base64?: string | null
          bill_data_confirmation_by?: string | null
          bill_data_confirmed_at?: string | null
          bill_holder_name?: string | null
          bill_message_id?: string | null
          bill_owner_relationship?: string | null
          bill_requested_at?: string | null
          bot_force_enabled?: boolean
          bot_paused?: boolean
          bot_paused_at?: string | null
          bot_paused_reason?: string | null
          bot_paused_until?: string | null
          bot_processing_until?: string | null
          capture_closed_at?: string | null
          capture_closed_by?: string | null
          capture_mode?: string
          capture_started_at?: string | null
          cashback?: string | null
          cashback_igreen?: string | null
          cep?: string | null
          chat_cleared_at?: string | null
          club_created_at?: string | null
          club_dry_run?: boolean | null
          club_error?: string | null
          club_error_kind?: string | null
          club_payload?: Json | null
          club_response?: Json | null
          club_status?: string | null
          club_updated_at?: string | null
          commission_rate?: number | null
          concessionaria?: string | null
          consultant_id?: string | null
          conta_pdf_protegida?: boolean | null
          contaunica?: boolean | null
          contaunica_answered?: boolean
          conversation_step?: string | null
          conversation_summary?: string | null
          conversational_flow_enabled?: boolean | null
          converted_at?: string | null
          cpf?: string | null
          created_at?: string
          ctwa_clid?: string | null
          custom_step_retries?: number
          custom_step_retries_step?: string | null
          customer_origin?: string
          customer_referred_by_consultant_id?: string | null
          customer_referred_by_name?: string | null
          customer_referred_by_phone?: string | null
          data_ativo?: string | null
          data_ativo_igreen?: string | null
          data_cadastro?: string | null
          data_cadastro_igreen?: string | null
          data_injecao_igreen?: string | null
          data_nascimento?: string | null
          data_nascimento_iso?: string | null
          data_validado?: string | null
          data_validado_igreen?: string | null
          debitos_aberto?: boolean | null
          desconto_cliente?: number | null
          detour_count?: number
          devolutiva?: string | null
          distribuidora?: string | null
          do_not_contact?: boolean
          doc_data_confirmation_by?: string | null
          doc_data_confirmed_at?: string | null
          doc_holder_name?: string | null
          document_back_base64?: string | null
          document_back_url?: string | null
          document_front_base64?: string | null
          document_front_url?: string | null
          document_type?: string | null
          document_uploaded?: boolean | null
          document_verify_at?: string | null
          document_verify_status?: string | null
          electricity_bill_photo_url?: string | null
          electricity_bill_value?: number | null
          electricity_boleto_photo_url?: string | null
          email?: string | null
          error_message?: string | null
          facial_confirmed_at?: string | null
          facial_link_sent_at?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          flow_variant?: string | null
          fluxo_b_state?: Json
          fluxo_b_variant?: string
          followup_count?: number
          followup_hook?: string | null
          fornecedora?: string | null
          historico_completo_at?: string | null
          id?: string
          igreen_account_id?: string | null
          igreen_code?: string | null
          igreen_link?: string | null
          intent_signals?: Json | null
          is_converted?: boolean
          is_sandbox?: boolean
          is_test_lead?: boolean
          last_bot_interaction_at?: string | null
          last_bot_reply_at?: string | null
          last_custom_prompt_at?: string | null
          last_enriched_at?: string | null
          last_followup_at?: string | null
          last_handoff_notified_at?: string | null
          last_inbound_media_at?: string | null
          last_inbound_media_kind?: string | null
          last_inbound_media_message_id?: string | null
          last_inbound_media_mime?: string | null
          last_inbound_media_url?: string | null
          last_new_lead_notified_at?: string | null
          last_otp_dispatch_at?: string | null
          last_otp_dispatch_error?: string | null
          last_partner_notified_at?: string | null
          last_portal_dispatch_at?: string | null
          last_portal_dispatch_error?: string | null
          last_rescue_at?: string | null
          last_rule_fire_at?: string | null
          last_rule_id?: string | null
          last_step_advanced_at?: string | null
          lead_source?: Json | null
          lead_source_detail?: Json | null
          link_assinatura?: string | null
          link_facial?: string | null
          link_facial_sent_at?: string | null
          logindistribuidora?: string | null
          manual_override_reactivate?: boolean
          manual_review_at?: string | null
          manual_review_reason?: string | null
          media_consumo?: number | null
          media_message_id?: string | null
          media_storage?: string | null
          meta_retargeting_synced_at?: string | null
          name?: string | null
          name_ask_sent_at?: string | null
          name_mismatch_acknowledged_at?: string | null
          name_mismatch_flag?: boolean
          name_mismatch_reason?: string | null
          name_source?: string | null
          needs_manual_review?: boolean
          next_followup_at?: string | null
          next_rescue_allowed_at?: string | null
          nivel_licenciado?: string | null
          nome_mae?: string | null
          nome_pai?: string | null
          nudge_sent_at?: string | null
          num_cliente_distribuidora?: string | null
          numero_instalacao?: string | null
          observacao?: string | null
          observacao_igreen?: string | null
          ocr_confianca?: number | null
          ocr_consumo_original?: number | null
          ocr_consumo_rejeitado?: boolean | null
          ocr_conta_attempts?: number
          ocr_doc_attempts?: number
          ocr_done?: boolean
          ocr_review_decided_at?: string | null
          ocr_review_decided_by?: string | null
          ocr_review_pending?: string | null
          ocr_review_started_at?: string | null
          orgao_expedidor?: string | null
          origin_channel?: string | null
          origin_consultant_id?: string | null
          origin_instance_name?: string | null
          origin_recovery?: string | null
          otp_code?: string | null
          otp_pending_replay?: boolean
          otp_received_at?: string | null
          otp_status?: string | null
          otp_status_checked_at?: string | null
          otp_test_phone?: string | null
          otp_validated_at?: string | null
          pain_point?: string | null
          pending_flow_switch?: string | null
          pending_inbound_at?: string | null
          pending_inbound_message_id?: string | null
          pending_snoozed_until?: string | null
          phone_contact_confirmed?: boolean
          phone_landline?: string | null
          phone_whatsapp?: string
          pj_jsonb?: Json | null
          portal_idconsultor_override?: number | null
          portal_last_retry_at?: string | null
          portal_retry_count?: number
          portal_submitted_at?: string | null
          portal2_celular_alt?: string | null
          portal2_contract_link?: string | null
          portal2_correction_attempts?: Json
          portal2_created_at?: string | null
          portal2_error?: string | null
          portal2_error_kind?: string | null
          portal2_extraction_mode?: string | null
          portal2_idcliente?: number | null
          portal2_idsolcontratovalidacao?: number | null
          portal2_ocr_bill_result?: Json | null
          portal2_ocr_doc_result?: Json | null
          portal2_otp_sent_at?: string | null
          portal2_otp_validated_at?: string | null
          portal2_status?: string | null
          pos_venda_approved_at?: string | null
          pos_venda_invalid?: boolean
          pos_venda_manual?: boolean
          pos_venda_pending_stage?: string | null
          pos_venda_reason?: string | null
          pos_venda_stage?: string | null
          possui_placas?: boolean | null
          possui_procurador?: boolean | null
          previous_conversation_step?: string | null
          procurador_jsonb?: Json | null
          qualification_score?: number | null
          referral_detected_at?: string | null
          referral_keyword_matched?: string | null
          referral_partner_id?: string | null
          registered_by_igreen_id?: string | null
          registered_by_name?: string | null
          rescue_attempts?: number
          rg?: string | null
          sales_phase?: string | null
          senha_pdf?: string | null
          senhadistribuidora?: string | null
          signature_summary?: Json | null
          situacao_igreen?: string | null
          source_ad_id?: string | null
          source_campaign_id?: string | null
          source_ctwa_clid?: string | null
          source_referral?: Json | null
          status?: string
          status_financeiro?: string | null
          summary_updated_at?: string | null
          terms_accepted_at?: string | null
          tipo_produto?: string
          tracking_protocol?: string | null
          transferir_titularidade?: boolean | null
          transferir_titularidade_answered?: boolean
          updated_at?: string
          variant_id?: string | null
          welcome_sent_at?: string | null
          whatsapp_chat_id?: string | null
          whatsapp_chat_id_checked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_assigned_consultant_id_fkey"
            columns: ["assigned_consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "customers_assigned_consultant_id_fkey"
            columns: ["assigned_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_assigned_consultant_id_fkey"
            columns: ["assigned_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_assigned_consultant_id_fkey"
            columns: ["assigned_consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "customers_customer_referred_by_consultant_id_fkey"
            columns: ["customer_referred_by_consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "customers_customer_referred_by_consultant_id_fkey"
            columns: ["customer_referred_by_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_customer_referred_by_consultant_id_fkey"
            columns: ["customer_referred_by_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_customer_referred_by_consultant_id_fkey"
            columns: ["customer_referred_by_consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "customers_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_referral_partner_id_fkey"
            columns: ["referral_partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_source_campaign_id_fkey"
            columns: ["source_campaign_id"]
            isOneToOne: false
            referencedRelation: "facebook_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reheat_kit: {
        Row: {
          bina_notes: string | null
          call_tts_fallback: string | null
          consultant_id: string
          created_at: string
          personalize_name: boolean
          sms_na_text: string | null
          sms_retry_text: string | null
          updated_at: string
          voice_audio_clip_id: string | null
          voice_audio_clip_id_retry: string | null
          wa_audio_fri_url: string | null
          wa_audio_mon_url: string | null
          wa_audio_sat_url: string | null
          wa_audio_thu_url: string | null
          wa_audio_tue_url: string | null
          wa_audio_wed_url: string | null
          wa_open_text: string | null
        }
        Insert: {
          bina_notes?: string | null
          call_tts_fallback?: string | null
          consultant_id: string
          created_at?: string
          personalize_name?: boolean
          sms_na_text?: string | null
          sms_retry_text?: string | null
          updated_at?: string
          voice_audio_clip_id?: string | null
          voice_audio_clip_id_retry?: string | null
          wa_audio_fri_url?: string | null
          wa_audio_mon_url?: string | null
          wa_audio_sat_url?: string | null
          wa_audio_thu_url?: string | null
          wa_audio_tue_url?: string | null
          wa_audio_wed_url?: string | null
          wa_open_text?: string | null
        }
        Update: {
          bina_notes?: string | null
          call_tts_fallback?: string | null
          consultant_id?: string
          created_at?: string
          personalize_name?: boolean
          sms_na_text?: string | null
          sms_retry_text?: string | null
          updated_at?: string
          voice_audio_clip_id?: string | null
          voice_audio_clip_id_retry?: string | null
          wa_audio_fri_url?: string | null
          wa_audio_mon_url?: string | null
          wa_audio_sat_url?: string | null
          wa_audio_thu_url?: string | null
          wa_audio_tue_url?: string | null
          wa_audio_wed_url?: string | null
          wa_open_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_reheat_kit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "daily_reheat_kit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reheat_kit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reheat_kit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "daily_reheat_kit_voice_audio_clip_id_fkey"
            columns: ["voice_audio_clip_id"]
            isOneToOne: false
            referencedRelation: "voice_audio_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reheat_kit_voice_audio_clip_id_retry_fkey"
            columns: ["voice_audio_clip_id_retry"]
            isOneToOne: false
            referencedRelation: "voice_audio_clips"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reheat_queue: {
        Row: {
          claim_attempts: number
          claim_token: string | null
          claimed_at: string | null
          consultant_id: string | null
          created_at: string
          customer_id: string
          cycle_date: string
          id: string
          lease_expires_at: string | null
          next_action_at: string
          planned_actions: Json
          queue: string
          run_id: string | null
          skip_reason: string | null
          status: string
          step: string
          updated_at: string
        }
        Insert: {
          claim_attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          consultant_id?: string | null
          created_at?: string
          customer_id: string
          cycle_date: string
          id?: string
          lease_expires_at?: string | null
          next_action_at?: string
          planned_actions?: Json
          queue: string
          run_id?: string | null
          skip_reason?: string | null
          status?: string
          step?: string
          updated_at?: string
        }
        Update: {
          claim_attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          consultant_id?: string | null
          created_at?: string
          customer_id?: string
          cycle_date?: string
          id?: string
          lease_expires_at?: string | null
          next_action_at?: string
          planned_actions?: Json
          queue?: string
          run_id?: string | null
          skip_reason?: string | null
          status?: string
          step?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_reheat_queue_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "daily_reheat_queue_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reheat_queue_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reheat_queue_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "daily_reheat_queue_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reheat_queue_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "daily_reheat_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reheat_runs: {
        Row: {
          candidates_a: number
          candidates_b: number
          dry_run: boolean
          id: string
          meta: Json
          run_at: string
          skipped_cap: number
          skipped_guards: number
          would_call: number
          would_send_whapi: number
          would_sms: number
        }
        Insert: {
          candidates_a?: number
          candidates_b?: number
          dry_run?: boolean
          id?: string
          meta?: Json
          run_at?: string
          skipped_cap?: number
          skipped_guards?: number
          would_call?: number
          would_send_whapi?: number
          would_sms?: number
        }
        Update: {
          candidates_a?: number
          candidates_b?: number
          dry_run?: boolean
          id?: string
          meta?: Json
          run_at?: string
          skipped_cap?: number
          skipped_guards?: number
          would_call?: number
          would_send_whapi?: number
          would_sms?: number
        }
        Relationships: []
      }
      daily_reheat_settings: {
        Row: {
          cold_min_age_hours: number
          cooldown_hours: number
          daily_whapi_cap: number
          enabled: boolean
          flow_variant: string
          id: string
          live_dispatch_enabled: boolean
          pilot_consultant_ids: string[]
          priority_queue: string
          queue_a_silence_hours: number
          queue_a_wait_minutes: number
          updated_at: string
          weekdays_only: boolean
          window_end_brt: string
          window_start_brt: string
        }
        Insert: {
          cold_min_age_hours?: number
          cooldown_hours?: number
          daily_whapi_cap?: number
          enabled?: boolean
          flow_variant?: string
          id?: string
          live_dispatch_enabled?: boolean
          pilot_consultant_ids?: string[]
          priority_queue?: string
          queue_a_silence_hours?: number
          queue_a_wait_minutes?: number
          updated_at?: string
          weekdays_only?: boolean
          window_end_brt?: string
          window_start_brt?: string
        }
        Update: {
          cold_min_age_hours?: number
          cooldown_hours?: number
          daily_whapi_cap?: number
          enabled?: boolean
          flow_variant?: string
          id?: string
          live_dispatch_enabled?: boolean
          pilot_consultant_ids?: string[]
          priority_queue?: string
          queue_a_silence_hours?: number
          queue_a_wait_minutes?: number
          updated_at?: string
          weekdays_only?: boolean
          window_end_brt?: string
          window_start_brt?: string
        }
        Relationships: []
      }
      engine_logs: {
        Row: {
          at: string
          customer_id: string
          flow_id: string
          id: number
          kind: string
          payload: Json
          side_effect: Json | null
          step_id: string | null
        }
        Insert: {
          at: string
          customer_id: string
          flow_id: string
          id?: number
          kind: string
          payload?: Json
          side_effect?: Json | null
          step_id?: string | null
        }
        Update: {
          at?: string
          customer_id?: string
          flow_id?: string
          id?: number
          kind?: string
          payload?: Json
          side_effect?: Json | null
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engine_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_logs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "bot_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_logs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "bot_flow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_ad_metrics_daily: {
        Row: {
          campaign_id: string
          clicks: number
          complete_registrations: number
          date: string
          fb_ad_id: string
          frequency_x100: number
          impressions: number
          leads: number
          messaging_conversations_started: number
          reach: number
          spend_cents: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          clicks?: number
          complete_registrations?: number
          date: string
          fb_ad_id: string
          frequency_x100?: number
          impressions?: number
          leads?: number
          messaging_conversations_started?: number
          reach?: number
          spend_cents?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          clicks?: number
          complete_registrations?: number
          date?: string
          fb_ad_id?: string
          frequency_x100?: number
          impressions?: number
          leads?: number
          messaging_conversations_started?: number
          reach?: number
          spend_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facebook_ad_metrics_daily_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "facebook_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_campaigns: {
        Row: {
          age_max: number
          age_min: number
          age_min_preferred: number | null
          brain_scale_enabled: boolean
          brain_scale_last_at: string | null
          brain_scale_max_budget_cents: number
          brain_scale_step_pct: number
          brain_scale_target_cpl_cents: number
          cities: Json
          commission_rate: number | null
          consultant_id: string
          created_at: string
          creative_format: string | null
          creative_pack_id: string | null
          daily_budget_cents: number
          distribuidora: string | null
          duration_days: number | null
          end_time_utc: string | null
          ended_at: string | null
          fb_ad_ids: Json
          fb_adset_ids: Json
          fb_campaign_id: string | null
          id: string
          initial_message: string | null
          leads_count: number
          lifetime_cap_cents: number | null
          migrated_to_abo_at: string | null
          name: string
          optimization_strategy: string
          parent_campaign_id: string | null
          pause_pending: boolean
          pixel_event_optimized: string | null
          rejection_reason: string | null
          started_at: string | null
          status: string
          thumbnail_synced_at: string | null
          thumbnail_url: string | null
          tracking_protocol: string | null
          tracking_protocol_channel: string | null
          updated_at: string
        }
        Insert: {
          age_max?: number
          age_min?: number
          age_min_preferred?: number | null
          brain_scale_enabled?: boolean
          brain_scale_last_at?: string | null
          brain_scale_max_budget_cents?: number
          brain_scale_step_pct?: number
          brain_scale_target_cpl_cents?: number
          cities?: Json
          commission_rate?: number | null
          consultant_id: string
          created_at?: string
          creative_format?: string | null
          creative_pack_id?: string | null
          daily_budget_cents: number
          distribuidora?: string | null
          duration_days?: number | null
          end_time_utc?: string | null
          ended_at?: string | null
          fb_ad_ids?: Json
          fb_adset_ids?: Json
          fb_campaign_id?: string | null
          id?: string
          initial_message?: string | null
          leads_count?: number
          lifetime_cap_cents?: number | null
          migrated_to_abo_at?: string | null
          name: string
          optimization_strategy?: string
          parent_campaign_id?: string | null
          pause_pending?: boolean
          pixel_event_optimized?: string | null
          rejection_reason?: string | null
          started_at?: string | null
          status?: string
          thumbnail_synced_at?: string | null
          thumbnail_url?: string | null
          tracking_protocol?: string | null
          tracking_protocol_channel?: string | null
          updated_at?: string
        }
        Update: {
          age_max?: number
          age_min?: number
          age_min_preferred?: number | null
          brain_scale_enabled?: boolean
          brain_scale_last_at?: string | null
          brain_scale_max_budget_cents?: number
          brain_scale_step_pct?: number
          brain_scale_target_cpl_cents?: number
          cities?: Json
          commission_rate?: number | null
          consultant_id?: string
          created_at?: string
          creative_format?: string | null
          creative_pack_id?: string | null
          daily_budget_cents?: number
          distribuidora?: string | null
          duration_days?: number | null
          end_time_utc?: string | null
          ended_at?: string | null
          fb_ad_ids?: Json
          fb_adset_ids?: Json
          fb_campaign_id?: string | null
          id?: string
          initial_message?: string | null
          leads_count?: number
          lifetime_cap_cents?: number | null
          migrated_to_abo_at?: string | null
          name?: string
          optimization_strategy?: string
          parent_campaign_id?: string | null
          pause_pending?: boolean
          pixel_event_optimized?: string | null
          rejection_reason?: string | null
          started_at?: string | null
          status?: string
          thumbnail_synced_at?: string | null
          thumbnail_url?: string | null
          tracking_protocol?: string | null
          tracking_protocol_channel?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facebook_campaigns_creative_pack_id_fkey"
            columns: ["creative_pack_id"]
            isOneToOne: false
            referencedRelation: "facebook_creative_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facebook_campaigns_parent_campaign_id_fkey"
            columns: ["parent_campaign_id"]
            isOneToOne: false
            referencedRelation: "facebook_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_capi_events: {
        Row: {
          consultant_id: string
          created_at: string
          customer_id: string | null
          event_id: string
          event_name: string
          event_time: string
          fb_response: Json | null
          id: string
          status: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          event_id: string
          event_name: string
          event_time?: string
          fb_response?: Json | null
          id?: string
          status?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          event_id?: string
          event_name?: string
          event_time?: string
          fb_response?: Json | null
          id?: string
          status?: string
        }
        Relationships: []
      }
      facebook_connections: {
        Row: {
          access_token_encrypted: string
          ad_account_currency: string | null
          ad_account_id: string | null
          ad_account_name: string | null
          audience_source_count: number | null
          audience_synced_at: string | null
          business_id: string | null
          business_name: string | null
          consultant_id: string
          created_at: string
          custom_audience_id: string | null
          fb_user_id: string
          fb_user_name: string | null
          id: string
          ig_account_id: string | null
          ig_account_username: string | null
          last_validated_at: string | null
          lookalike_audience_id: string | null
          page_id: string | null
          page_name: string | null
          pixel_id: string | null
          pixel_name: string | null
          status: string
          token_expires_at: string | null
          updated_at: string
          validation_errors: Json | null
          whatsapp_destination_number: string | null
          whatsapp_display_number: string | null
          whatsapp_phone_number_id: string | null
        }
        Insert: {
          access_token_encrypted: string
          ad_account_currency?: string | null
          ad_account_id?: string | null
          ad_account_name?: string | null
          audience_source_count?: number | null
          audience_synced_at?: string | null
          business_id?: string | null
          business_name?: string | null
          consultant_id: string
          created_at?: string
          custom_audience_id?: string | null
          fb_user_id: string
          fb_user_name?: string | null
          id?: string
          ig_account_id?: string | null
          ig_account_username?: string | null
          last_validated_at?: string | null
          lookalike_audience_id?: string | null
          page_id?: string | null
          page_name?: string | null
          pixel_id?: string | null
          pixel_name?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          validation_errors?: Json | null
          whatsapp_destination_number?: string | null
          whatsapp_display_number?: string | null
          whatsapp_phone_number_id?: string | null
        }
        Update: {
          access_token_encrypted?: string
          ad_account_currency?: string | null
          ad_account_id?: string | null
          ad_account_name?: string | null
          audience_source_count?: number | null
          audience_synced_at?: string | null
          business_id?: string | null
          business_name?: string | null
          consultant_id?: string
          created_at?: string
          custom_audience_id?: string | null
          fb_user_id?: string
          fb_user_name?: string | null
          id?: string
          ig_account_id?: string | null
          ig_account_username?: string | null
          last_validated_at?: string | null
          lookalike_audience_id?: string | null
          page_id?: string | null
          page_name?: string | null
          pixel_id?: string | null
          pixel_name?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          validation_errors?: Json | null
          whatsapp_destination_number?: string | null
          whatsapp_display_number?: string | null
          whatsapp_phone_number_id?: string | null
        }
        Relationships: []
      }
      facebook_creative_packs: {
        Row: {
          consultant_id: string
          copy_pack: Json
          created_at: string
          generated_variants: Json
          id: string
          name: string
          photos: Json
          updated_at: string
        }
        Insert: {
          consultant_id: string
          copy_pack?: Json
          created_at?: string
          generated_variants?: Json
          id?: string
          name?: string
          photos?: Json
          updated_at?: string
        }
        Update: {
          consultant_id?: string
          copy_pack?: Json
          created_at?: string
          generated_variants?: Json
          id?: string
          name?: string
          photos?: Json
          updated_at?: string
        }
        Relationships: []
      }
      facebook_metrics_daily: {
        Row: {
          campaign_id: string
          clicks: number
          complete_registrations: number
          cost_per_lead_cents: number
          cpl_by_placement: Json | null
          cpm_cents: number
          ctr_bps: number
          customers_acquired: number
          date: string
          frequency_x100: number
          gross_spend_cents: number
          impressions: number
          leads: number
          messaging_conversations_started: number
          meta_conversations: number
          meta_lead_actions: number
          platform_fee_cents: number
          reach: number
          spend_cents: number
          synced_to_wallet_cents: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          clicks?: number
          complete_registrations?: number
          cost_per_lead_cents?: number
          cpl_by_placement?: Json | null
          cpm_cents?: number
          ctr_bps?: number
          customers_acquired?: number
          date: string
          frequency_x100?: number
          gross_spend_cents?: number
          impressions?: number
          leads?: number
          messaging_conversations_started?: number
          meta_conversations?: number
          meta_lead_actions?: number
          platform_fee_cents?: number
          reach?: number
          spend_cents?: number
          synced_to_wallet_cents?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          clicks?: number
          complete_registrations?: number
          cost_per_lead_cents?: number
          cpl_by_placement?: Json | null
          cpm_cents?: number
          ctr_bps?: number
          customers_acquired?: number
          date?: string
          frequency_x100?: number
          gross_spend_cents?: number
          impressions?: number
          leads?: number
          messaging_conversations_started?: number
          meta_conversations?: number
          meta_lead_actions?: number
          platform_fee_cents?: number
          reach?: number
          spend_cents?: number
          synced_to_wallet_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facebook_metrics_daily_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "facebook_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_city_cache: {
        Row: {
          country_code: string
          created_at: string
          fb_key: string
          name: string
          region: string | null
          region_id: number | null
          uf: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          fb_key: string
          name: string
          region?: string | null
          region_id?: number | null
          uf: string
        }
        Update: {
          country_code?: string
          created_at?: string
          fb_key?: string
          name?: string
          region?: string | null
          region_id?: number | null
          uf?: string
        }
        Relationships: []
      }
      flow_d_health_runs: {
        Row: {
          duration_ms: number | null
          errors: Json | null
          id: string
          leads_scanned: number | null
          leads_unstuck: number | null
          ran_at: string
        }
        Insert: {
          duration_ms?: number | null
          errors?: Json | null
          id?: string
          leads_scanned?: number | null
          leads_unstuck?: number | null
          ran_at?: string
        }
        Update: {
          duration_ms?: number | null
          errors?: Json | null
          id?: string
          leads_scanned?: number | null
          leads_unstuck?: number | null
          ran_at?: string
        }
        Relationships: []
      }
      flow_router_rules: {
        Row: {
          consultant_id: string | null
          created_at: string
          id: string
          is_active: boolean
          priority: number
          target_flow_key: string
          target_flow_label: string
          trigger_keywords: string[]
          updated_at: string
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          target_flow_key: string
          target_flow_label: string
          trigger_keywords: string[]
          updated_at?: string
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          target_flow_key?: string
          target_flow_label?: string
          trigger_keywords?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_router_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "flow_router_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_router_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_router_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      flow_template_submissions: {
        Row: {
          author_consultant_id: string
          author_name: string | null
          author_phone: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          show_phone: boolean
          source_flow_id: string | null
          status: string
          steps_snapshot: Json
          updated_at: string
          variant: string
        }
        Insert: {
          author_consultant_id: string
          author_name?: string | null
          author_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          show_phone?: boolean
          source_flow_id?: string | null
          status?: string
          steps_snapshot?: Json
          updated_at?: string
          variant?: string
        }
        Update: {
          author_consultant_id?: string
          author_name?: string | null
          author_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          show_phone?: boolean
          source_flow_id?: string | null
          status?: string
          steps_snapshot?: Json
          updated_at?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_template_submissions_author_consultant_id_fkey"
            columns: ["author_consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "flow_template_submissions_author_consultant_id_fkey"
            columns: ["author_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_template_submissions_author_consultant_id_fkey"
            columns: ["author_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_template_submissions_author_consultant_id_fkey"
            columns: ["author_consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "flow_template_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "flow_template_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_template_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_template_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "flow_template_submissions_source_flow_id_fkey"
            columns: ["source_flow_id"]
            isOneToOne: false
            referencedRelation: "bot_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_variants: {
        Row: {
          consultant_overrides: Json
          created_at: string
          descricao: string | null
          fluxo: string
          id: string
          is_active: boolean
          nome: string
          updated_at: string
          weight: number
        }
        Insert: {
          consultant_overrides?: Json
          created_at?: string
          descricao?: string | null
          fluxo: string
          id: string
          is_active?: boolean
          nome: string
          updated_at?: string
          weight?: number
        }
        Update: {
          consultant_overrides?: Json
          created_at?: string
          descricao?: string | null
          fluxo?: string
          id?: string
          is_active?: boolean
          nome?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      force_bot_phones: {
        Row: {
          consultant_id: string
          created_at: string
          phone_digits: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          phone_digits: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          phone_digits?: string
        }
        Relationships: []
      }
      gemini_quota_bucket: {
        Row: {
          capacity: number
          consultant_id: string
          refill_per_minute: number
          refilled_at: string
          tokens: number
        }
        Insert: {
          capacity?: number
          consultant_id: string
          refill_per_minute?: number
          refilled_at?: string
          tokens?: number
        }
        Update: {
          capacity?: number
          consultant_id?: string
          refill_per_minute?: number
          refilled_at?: string
          tokens?: number
        }
        Relationships: []
      }
      holidays: {
        Row: {
          consultant_id: string | null
          created_at: string
          date: string
          id: string
          label: string | null
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          date: string
          id?: string
          label?: string | null
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          date?: string
          id?: string
          label?: string | null
        }
        Relationships: []
      }
      igreen_automation_settings: {
        Row: {
          alert_boletos_vencendo: boolean
          alert_devolutivas: boolean
          alert_licencas_expirando: boolean
          auto_wa_aniversariante: boolean
          auto_wa_boleto_vencendo: boolean
          capture_boletos: boolean
          capture_cashback: boolean
          capture_devolutivas: boolean
          capture_seguros: boolean
          capture_telecom: boolean
          consultant_id: string
          created_at: string
          cross_sell_bot: boolean
          last_sync_boletos: string | null
          last_sync_cashback: string | null
          last_sync_customers: string | null
          last_sync_devolutivas: string | null
          last_sync_metrics: string | null
          last_sync_network: string | null
          last_sync_painel_rede: string | null
          last_sync_seguros: string | null
          last_sync_telecom: string | null
          rotinas_tarefas: boolean
          updated_at: string
        }
        Insert: {
          alert_boletos_vencendo?: boolean
          alert_devolutivas?: boolean
          alert_licencas_expirando?: boolean
          auto_wa_aniversariante?: boolean
          auto_wa_boleto_vencendo?: boolean
          capture_boletos?: boolean
          capture_cashback?: boolean
          capture_devolutivas?: boolean
          capture_seguros?: boolean
          capture_telecom?: boolean
          consultant_id: string
          created_at?: string
          cross_sell_bot?: boolean
          last_sync_boletos?: string | null
          last_sync_cashback?: string | null
          last_sync_customers?: string | null
          last_sync_devolutivas?: string | null
          last_sync_metrics?: string | null
          last_sync_network?: string | null
          last_sync_painel_rede?: string | null
          last_sync_seguros?: string | null
          last_sync_telecom?: string | null
          rotinas_tarefas?: boolean
          updated_at?: string
        }
        Update: {
          alert_boletos_vencendo?: boolean
          alert_devolutivas?: boolean
          alert_licencas_expirando?: boolean
          auto_wa_aniversariante?: boolean
          auto_wa_boleto_vencendo?: boolean
          capture_boletos?: boolean
          capture_cashback?: boolean
          capture_devolutivas?: boolean
          capture_seguros?: boolean
          capture_telecom?: boolean
          consultant_id?: string
          created_at?: string
          cross_sell_bot?: boolean
          last_sync_boletos?: string | null
          last_sync_cashback?: string | null
          last_sync_customers?: string | null
          last_sync_devolutivas?: string | null
          last_sync_metrics?: string | null
          last_sync_network?: string | null
          last_sync_painel_rede?: string | null
          last_sync_seguros?: string | null
          last_sync_telecom?: string | null
          rotinas_tarefas?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "igreen_automation_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_automation_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_automation_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_automation_settings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      igreen_bulk_sync_state: {
        Row: {
          completed: number
          consultant_ids: Json
          created_at: string
          current_consultant_id: string | null
          failed: number
          full_history: boolean
          id: string
          results: Json
          started_by: string | null
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          completed?: number
          consultant_ids?: Json
          created_at?: string
          current_consultant_id?: string | null
          failed?: number
          full_history?: boolean
          id?: string
          results?: Json
          started_by?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          completed?: number
          consultant_ids?: Json
          created_at?: string
          current_consultant_id?: string | null
          failed?: number
          full_history?: boolean
          id?: string
          results?: Json
          started_by?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      igreen_campanha_boleto_elegiveis: {
        Row: {
          abertos: number | null
          celular: string | null
          cidade: string | null
          consultant_id: string
          dias_atraso: number | null
          id: string
          idcliente: number
          idlicenciado: string | null
          igreen_account_id: string | null
          licenciado: string | null
          nome: string | null
          propria: boolean | null
          raw_json: Json | null
          synced_at: string | null
          uf: string | null
          updated_at: string | null
          url_boleto: string | null
          valor: number | null
          vencimento: string | null
        }
        Insert: {
          abertos?: number | null
          celular?: string | null
          cidade?: string | null
          consultant_id: string
          dias_atraso?: number | null
          id?: string
          idcliente: number
          idlicenciado?: string | null
          igreen_account_id?: string | null
          licenciado?: string | null
          nome?: string | null
          propria?: boolean | null
          raw_json?: Json | null
          synced_at?: string | null
          uf?: string | null
          updated_at?: string | null
          url_boleto?: string | null
          valor?: number | null
          vencimento?: string | null
        }
        Update: {
          abertos?: number | null
          celular?: string | null
          cidade?: string | null
          consultant_id?: string
          dias_atraso?: number | null
          id?: string
          idcliente?: number
          idlicenciado?: string | null
          igreen_account_id?: string | null
          licenciado?: string | null
          nome?: string | null
          propria?: boolean | null
          raw_json?: Json | null
          synced_at?: string | null
          uf?: string | null
          updated_at?: string | null
          url_boleto?: string | null
          valor?: number | null
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "igreen_campanha_boleto_elegiveis_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_campanha_boleto_elegiveis_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_campanha_boleto_elegiveis_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_campanha_boleto_elegiveis_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_campanha_boleto_elegiveis_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_consultant_metrics: {
        Row: {
          ag_assinatura_n: number | null
          aguardando_n: number | null
          campanha_boleto_json: Json | null
          cancelados_n: number | null
          cashback_green_saldo: number | null
          cashback_json: Json | null
          cashback_seguros_saldo: number | null
          cashback_telecom_saldo: number | null
          clientes_green: number | null
          clientes_seguros: number | null
          clientes_telecom: number | null
          clientes_total: number | null
          consultant_id: string
          created_at: string
          devolutivas_n: number | null
          diretos: number | null
          diretos_ativos: number | null
          extrato_expansao_json: Json | null
          extrato_kwh_json: Json | null
          financeiro_json: Json | null
          gi_mes: number | null
          gp_mes: number | null
          id: string
          igreen_account_id: string | null
          kwh_validados: number | null
          licenciados_ativos: number | null
          licenciados_total: number | null
          mes_ref: string
          mwh: number | null
          painel_inativos_json: Json | null
          painel_onboarding_json: Json | null
          painel_ranking_json: Json | null
          raw_json: Json | null
          rede_overview_json: Json | null
          rede_ranking_pos: number | null
          rede_tamanho: number | null
          reprovados_n: number | null
          rotina_diaria: Json | null
          rotina_mensal: Json | null
          rotina_semanal: Json | null
          seguros_apolices_total: number | null
          seguros_pendencias_json: Json | null
          seguros_resumo_json: Json | null
          synced_at: string
          telecom_ativos_total: number | null
          telecom_pendencias_json: Json | null
          telecom_resumo_json: Json | null
          total_cadastros: number | null
          updated_at: string
          validados_n: number | null
        }
        Insert: {
          ag_assinatura_n?: number | null
          aguardando_n?: number | null
          campanha_boleto_json?: Json | null
          cancelados_n?: number | null
          cashback_green_saldo?: number | null
          cashback_json?: Json | null
          cashback_seguros_saldo?: number | null
          cashback_telecom_saldo?: number | null
          clientes_green?: number | null
          clientes_seguros?: number | null
          clientes_telecom?: number | null
          clientes_total?: number | null
          consultant_id: string
          created_at?: string
          devolutivas_n?: number | null
          diretos?: number | null
          diretos_ativos?: number | null
          extrato_expansao_json?: Json | null
          extrato_kwh_json?: Json | null
          financeiro_json?: Json | null
          gi_mes?: number | null
          gp_mes?: number | null
          id?: string
          igreen_account_id?: string | null
          kwh_validados?: number | null
          licenciados_ativos?: number | null
          licenciados_total?: number | null
          mes_ref: string
          mwh?: number | null
          painel_inativos_json?: Json | null
          painel_onboarding_json?: Json | null
          painel_ranking_json?: Json | null
          raw_json?: Json | null
          rede_overview_json?: Json | null
          rede_ranking_pos?: number | null
          rede_tamanho?: number | null
          reprovados_n?: number | null
          rotina_diaria?: Json | null
          rotina_mensal?: Json | null
          rotina_semanal?: Json | null
          seguros_apolices_total?: number | null
          seguros_pendencias_json?: Json | null
          seguros_resumo_json?: Json | null
          synced_at?: string
          telecom_ativos_total?: number | null
          telecom_pendencias_json?: Json | null
          telecom_resumo_json?: Json | null
          total_cadastros?: number | null
          updated_at?: string
          validados_n?: number | null
        }
        Update: {
          ag_assinatura_n?: number | null
          aguardando_n?: number | null
          campanha_boleto_json?: Json | null
          cancelados_n?: number | null
          cashback_green_saldo?: number | null
          cashback_json?: Json | null
          cashback_seguros_saldo?: number | null
          cashback_telecom_saldo?: number | null
          clientes_green?: number | null
          clientes_seguros?: number | null
          clientes_telecom?: number | null
          clientes_total?: number | null
          consultant_id?: string
          created_at?: string
          devolutivas_n?: number | null
          diretos?: number | null
          diretos_ativos?: number | null
          extrato_expansao_json?: Json | null
          extrato_kwh_json?: Json | null
          financeiro_json?: Json | null
          gi_mes?: number | null
          gp_mes?: number | null
          id?: string
          igreen_account_id?: string | null
          kwh_validados?: number | null
          licenciados_ativos?: number | null
          licenciados_total?: number | null
          mes_ref?: string
          mwh?: number | null
          painel_inativos_json?: Json | null
          painel_onboarding_json?: Json | null
          painel_ranking_json?: Json | null
          raw_json?: Json | null
          rede_overview_json?: Json | null
          rede_ranking_pos?: number | null
          rede_tamanho?: number | null
          reprovados_n?: number | null
          rotina_diaria?: Json | null
          rotina_mensal?: Json | null
          rotina_semanal?: Json | null
          seguros_apolices_total?: number | null
          seguros_pendencias_json?: Json | null
          seguros_resumo_json?: Json | null
          synced_at?: string
          telecom_ativos_total?: number | null
          telecom_pendencias_json?: Json | null
          telecom_resumo_json?: Json | null
          total_cadastros?: number | null
          updated_at?: string
          validados_n?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "igreen_consultant_metrics_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_consultant_metrics_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_consultant_metrics_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_consultant_metrics_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_consultant_metrics_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_customer_boletos: {
        Row: {
          cidade: string | null
          consultant_id: string
          conta_unica: boolean | null
          created_at: string
          customer_id: string | null
          dias_atraso: number | null
          fornecedora: string | null
          id: string
          idcliente: number
          igreen_account_id: string | null
          injecao: boolean | null
          kwh_compensado: number | null
          mes_referencia: string | null
          nome: string | null
          pagamento: string | null
          raw_json: Json | null
          status: string | null
          synced_at: string
          tipo_pagamento: string | null
          total: number | null
          uf: string | null
          updated_at: string
          url_boleto: string | null
          url_invoice: string | null
          valor_distribuidora: number | null
          valor_fornecedora: number | null
          vencimento: string | null
        }
        Insert: {
          cidade?: string | null
          consultant_id: string
          conta_unica?: boolean | null
          created_at?: string
          customer_id?: string | null
          dias_atraso?: number | null
          fornecedora?: string | null
          id?: string
          idcliente: number
          igreen_account_id?: string | null
          injecao?: boolean | null
          kwh_compensado?: number | null
          mes_referencia?: string | null
          nome?: string | null
          pagamento?: string | null
          raw_json?: Json | null
          status?: string | null
          synced_at?: string
          tipo_pagamento?: string | null
          total?: number | null
          uf?: string | null
          updated_at?: string
          url_boleto?: string | null
          url_invoice?: string | null
          valor_distribuidora?: number | null
          valor_fornecedora?: number | null
          vencimento?: string | null
        }
        Update: {
          cidade?: string | null
          consultant_id?: string
          conta_unica?: boolean | null
          created_at?: string
          customer_id?: string | null
          dias_atraso?: number | null
          fornecedora?: string | null
          id?: string
          idcliente?: number
          igreen_account_id?: string | null
          injecao?: boolean | null
          kwh_compensado?: number | null
          mes_referencia?: string | null
          nome?: string | null
          pagamento?: string | null
          raw_json?: Json | null
          status?: string | null
          synced_at?: string
          tipo_pagamento?: string | null
          total?: number | null
          uf?: string | null
          updated_at?: string
          url_boleto?: string | null
          url_invoice?: string | null
          valor_distribuidora?: number | null
          valor_fornecedora?: number | null
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "igreen_customer_boletos_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_customer_devolutivas: {
        Row: {
          campo: string | null
          categoria: string | null
          cidade: string | null
          consultant_id: string
          created_at: string
          customer_id: string | null
          data_devolutiva: string | null
          id: string
          idcliente: number
          iddevolutiva: number | null
          igreen_account_id: string | null
          impeditiva: boolean | null
          licenciado: string | null
          motivo: string | null
          nome: string | null
          propria: boolean | null
          raw_json: Json | null
          resolvida_em: string | null
          synced_at: string
          uf: string | null
          updated_at: string
        }
        Insert: {
          campo?: string | null
          categoria?: string | null
          cidade?: string | null
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          data_devolutiva?: string | null
          id?: string
          idcliente: number
          iddevolutiva?: number | null
          igreen_account_id?: string | null
          impeditiva?: boolean | null
          licenciado?: string | null
          motivo?: string | null
          nome?: string | null
          propria?: boolean | null
          raw_json?: Json | null
          resolvida_em?: string | null
          synced_at?: string
          uf?: string | null
          updated_at?: string
        }
        Update: {
          campo?: string | null
          categoria?: string | null
          cidade?: string | null
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          data_devolutiva?: string | null
          id?: string
          idcliente?: number
          iddevolutiva?: number | null
          igreen_account_id?: string | null
          impeditiva?: boolean | null
          licenciado?: string | null
          motivo?: string | null
          nome?: string | null
          propria?: boolean | null
          raw_json?: Json | null
          resolvida_em?: string | null
          synced_at?: string
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "igreen_customer_devolutivas_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_customer_devolutivas_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_devolutivas_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_devolutivas_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_customer_devolutivas_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_devolutivas_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_endpoint_discovery: {
        Row: {
          bucket: string | null
          bytes: number | null
          category: string | null
          checked_at: string
          content_type: string | null
          created_at: string
          id: string
          is_alive: boolean
          method: string
          ms: number | null
          notes: string | null
          path: string
          sample_body: string | null
          status: number | null
          updated_at: string
        }
        Insert: {
          bucket?: string | null
          bytes?: number | null
          category?: string | null
          checked_at?: string
          content_type?: string | null
          created_at?: string
          id?: string
          is_alive?: boolean
          method: string
          ms?: number | null
          notes?: string | null
          path: string
          sample_body?: string | null
          status?: number | null
          updated_at?: string
        }
        Update: {
          bucket?: string | null
          bytes?: number | null
          category?: string | null
          checked_at?: string
          content_type?: string | null
          created_at?: string
          id?: string
          is_alive?: boolean
          method?: string
          ms?: number | null
          notes?: string | null
          path?: string
          sample_body?: string | null
          status?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      igreen_network_snapshots: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          igreen_account_id: string | null
          mes_referencia: string
          payload: Json
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          igreen_account_id?: string | null
          mes_referencia: string
          payload?: Json
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          igreen_account_id?: string | null
          mes_referencia?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "igreen_network_snapshots_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_portal_accounts: {
        Row: {
          consultant_id: string
          created_at: string
          credential_checked_at: string | null
          credential_status: string | null
          id: string
          igreen_consultor_id: string | null
          label: string | null
          last_sync_at: string | null
          portal_email: string
          portal_password: string
          position: number
          updated_at: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          credential_checked_at?: string | null
          credential_status?: string | null
          id?: string
          igreen_consultor_id?: string | null
          label?: string | null
          last_sync_at?: string | null
          portal_email: string
          portal_password: string
          position?: number
          updated_at?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          credential_checked_at?: string | null
          credential_status?: string | null
          id?: string
          igreen_consultor_id?: string | null
          label?: string | null
          last_sync_at?: string | null
          portal_email?: string
          portal_password?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "igreen_portal_accounts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_portal_accounts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_portal_accounts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_portal_accounts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      igreen_recon_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          done_at: string | null
          id: string
          kind: string
          last_error: string | null
          params: Json
          priority: number
          result_id: string | null
          status: string
          target: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          params?: Json
          priority?: number
          result_id?: string | null
          status?: string
          target: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          params?: Json
          priority?: number
          result_id?: string | null
          status?: string
          target?: string
          updated_at?: string
        }
        Relationships: []
      }
      igreen_recon_routes: {
        Row: {
          ai_fields: Json | null
          ai_summary: string | null
          consultant_email: string | null
          consultant_id: string | null
          created_at: string
          dom_outline: Json | null
          elapsed_ms: number | null
          error: string | null
          final_path: string | null
          html_length: number | null
          html_snippet: string | null
          id: string
          job_id: string | null
          kind: string | null
          new_endpoints: Json | null
          raw_response: Json | null
          route: string
          run_id: string
          screenshot_path: string | null
          suggested_columns: Json | null
          title: string | null
        }
        Insert: {
          ai_fields?: Json | null
          ai_summary?: string | null
          consultant_email?: string | null
          consultant_id?: string | null
          created_at?: string
          dom_outline?: Json | null
          elapsed_ms?: number | null
          error?: string | null
          final_path?: string | null
          html_length?: number | null
          html_snippet?: string | null
          id?: string
          job_id?: string | null
          kind?: string | null
          new_endpoints?: Json | null
          raw_response?: Json | null
          route: string
          run_id: string
          screenshot_path?: string | null
          suggested_columns?: Json | null
          title?: string | null
        }
        Update: {
          ai_fields?: Json | null
          ai_summary?: string | null
          consultant_email?: string | null
          consultant_id?: string | null
          created_at?: string
          dom_outline?: Json | null
          elapsed_ms?: number | null
          error?: string | null
          final_path?: string | null
          html_length?: number | null
          html_snippet?: string | null
          id?: string
          job_id?: string | null
          kind?: string | null
          new_endpoints?: Json | null
          raw_response?: Json | null
          route?: string
          run_id?: string
          screenshot_path?: string | null
          suggested_columns?: Json | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "igreen_recon_routes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "igreen_recon_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_seguros_comissoes: {
        Row: {
          consultant_id: string
          created_at: string
          descricao: string | null
          external_id: string | null
          id: string
          igreen_account_id: string | null
          mes_referencia: string
          origem: string | null
          raw: Json
          status: string | null
          updated_at: string
          valor_cents: number | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          descricao?: string | null
          external_id?: string | null
          id?: string
          igreen_account_id?: string | null
          mes_referencia: string
          origem?: string | null
          raw?: Json
          status?: string | null
          updated_at?: string
          valor_cents?: number | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          descricao?: string | null
          external_id?: string | null
          id?: string
          igreen_account_id?: string | null
          mes_referencia?: string
          origem?: string | null
          raw?: Json
          status?: string | null
          updated_at?: string
          valor_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "igreen_seguros_comissoes_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_seguros_customers: {
        Row: {
          apolice_id: string | null
          cashback_previsto_cents: number | null
          cidade: string | null
          consultant_id: string
          created_at: string
          fipe: number | null
          id: string
          igreen_account_id: string | null
          licenciado: string | null
          mensal: number | null
          modelo: string | null
          placa: string | null
          raw_json: Json | null
          renovacao_prevista_at: string | null
          segurado: string | null
          seguro_id: string
          sinistros: Json | null
          status: string | null
          status_label: string | null
          synced_at: string
          uf: string | null
          updated_at: string
        }
        Insert: {
          apolice_id?: string | null
          cashback_previsto_cents?: number | null
          cidade?: string | null
          consultant_id: string
          created_at?: string
          fipe?: number | null
          id?: string
          igreen_account_id?: string | null
          licenciado?: string | null
          mensal?: number | null
          modelo?: string | null
          placa?: string | null
          raw_json?: Json | null
          renovacao_prevista_at?: string | null
          segurado?: string | null
          seguro_id: string
          sinistros?: Json | null
          status?: string | null
          status_label?: string | null
          synced_at?: string
          uf?: string | null
          updated_at?: string
        }
        Update: {
          apolice_id?: string | null
          cashback_previsto_cents?: number | null
          cidade?: string | null
          consultant_id?: string
          created_at?: string
          fipe?: number | null
          id?: string
          igreen_account_id?: string | null
          licenciado?: string | null
          mensal?: number | null
          modelo?: string | null
          placa?: string | null
          raw_json?: Json | null
          renovacao_prevista_at?: string | null
          segurado?: string | null
          seguro_id?: string
          sinistros?: Json | null
          status?: string | null
          status_label?: string | null
          synced_at?: string
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "igreen_seguros_customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_seguros_customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_seguros_customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_seguros_customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_seguros_customers_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_sync_runs: {
        Row: {
          consultant_id: string
          counts: Json
          error: string | null
          finished_at: string | null
          id: string
          mode: string
          started_at: string
          status: string
        }
        Insert: {
          consultant_id: string
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          mode: string
          started_at?: string
          status?: string
        }
        Update: {
          consultant_id?: string
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "igreen_sync_runs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_sync_runs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_sync_runs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_sync_runs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      igreen_telecom_comissoes: {
        Row: {
          consultant_id: string
          created_at: string
          descricao: string | null
          external_id: string | null
          id: string
          igreen_account_id: string | null
          mes_referencia: string
          origem: string | null
          raw: Json
          status: string | null
          updated_at: string
          valor_cents: number | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          descricao?: string | null
          external_id?: string | null
          id?: string
          igreen_account_id?: string | null
          mes_referencia: string
          origem?: string | null
          raw?: Json
          status?: string | null
          updated_at?: string
          valor_cents?: number | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          descricao?: string | null
          external_id?: string | null
          id?: string
          igreen_account_id?: string | null
          mes_referencia?: string
          origem?: string | null
          raw?: Json
          status?: string | null
          updated_at?: string
          valor_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "igreen_telecom_comissoes_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_telecom_customers: {
        Row: {
          cidade: string | null
          consultant_id: string
          created_at: string
          data: string | null
          fatura_mes_referencia: string | null
          fatura_status: string | null
          fatura_valor: number | null
          id: string
          idcnxtelecom: number
          igreen_account_id: string | null
          licenciado: string | null
          nome: string | null
          numero: string | null
          raw_json: Json | null
          status: string | null
          status_label: string | null
          synced_at: string
          uf: string | null
          updated_at: string
        }
        Insert: {
          cidade?: string | null
          consultant_id: string
          created_at?: string
          data?: string | null
          fatura_mes_referencia?: string | null
          fatura_status?: string | null
          fatura_valor?: number | null
          id?: string
          idcnxtelecom: number
          igreen_account_id?: string | null
          licenciado?: string | null
          nome?: string | null
          numero?: string | null
          raw_json?: Json | null
          status?: string | null
          status_label?: string | null
          synced_at?: string
          uf?: string | null
          updated_at?: string
        }
        Update: {
          cidade?: string | null
          consultant_id?: string
          created_at?: string
          data?: string | null
          fatura_mes_referencia?: string | null
          fatura_status?: string | null
          fatura_valor?: number | null
          id?: string
          idcnxtelecom?: number
          igreen_account_id?: string | null
          licenciado?: string | null
          nome?: string | null
          numero?: string | null
          raw_json?: Json | null
          status?: string | null
          status_label?: string | null
          synced_at?: string
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "igreen_telecom_customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_telecom_customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_telecom_customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_telecom_customers_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_telecom_customers_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_telecom_faturas: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          idcnxtelecom: string | null
          igreen_account_id: string | null
          mes_referencia: string
          msisdn: string | null
          pago_em: string | null
          raw: Json
          status: string | null
          updated_at: string
          valor_cents: number | null
          vencimento: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          idcnxtelecom?: string | null
          igreen_account_id?: string | null
          mes_referencia: string
          msisdn?: string | null
          pago_em?: string | null
          raw?: Json
          status?: string | null
          updated_at?: string
          valor_cents?: number | null
          vencimento?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          idcnxtelecom?: string | null
          igreen_account_id?: string | null
          mes_referencia?: string
          msisdn?: string | null
          pago_em?: string | null
          raw?: Json
          status?: string | null
          updated_at?: string
          valor_cents?: number | null
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "igreen_telecom_faturas_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      igreen_telecom_linhas: {
        Row: {
          ativada_em: string | null
          cancelada_em: string | null
          cliente_cpf: string | null
          cliente_nome: string | null
          consultant_id: string
          created_at: string
          iccid: string | null
          id: string
          idcnxtelecom: string | null
          igreen_account_id: string | null
          msisdn: string | null
          plano: string | null
          raw: Json
          status: string | null
          updated_at: string
        }
        Insert: {
          ativada_em?: string | null
          cancelada_em?: string | null
          cliente_cpf?: string | null
          cliente_nome?: string | null
          consultant_id: string
          created_at?: string
          iccid?: string | null
          id?: string
          idcnxtelecom?: string | null
          igreen_account_id?: string | null
          msisdn?: string | null
          plano?: string | null
          raw?: Json
          status?: string | null
          updated_at?: string
        }
        Update: {
          ativada_em?: string | null
          cancelada_em?: string | null
          cliente_cpf?: string | null
          cliente_nome?: string | null
          consultant_id?: string
          created_at?: string
          iccid?: string | null
          id?: string
          idcnxtelecom?: string | null
          igreen_account_id?: string | null
          msisdn?: string | null
          plano?: string | null
          raw?: Json
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "igreen_telecom_linhas_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_media_failures: {
        Row: {
          consultant_id: string
          created_at: string
          customer_id: string
          id: number
          message_id: string
          raw_payload: Json | null
          reason: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          customer_id: string
          id?: number
          message_id: string
          raw_payload?: Json | null
          reason: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          customer_id?: string
          id?: number
          message_id?: string
          raw_payload?: Json | null
          reason?: string
        }
        Relationships: []
      }
      inbound_media_retry: {
        Row: {
          attempts: number
          base64: string
          consultant_id: string
          created_at: string
          customer_id: string
          expires_at: string
          id: number
          media_kind: string
          message_id: string
          mime_type: string | null
          next_attempt_at: string
          succeeded_at: string | null
        }
        Insert: {
          attempts?: number
          base64: string
          consultant_id: string
          created_at?: string
          customer_id: string
          expires_at?: string
          id?: number
          media_kind: string
          message_id: string
          mime_type?: string | null
          next_attempt_at?: string
          succeeded_at?: string | null
        }
        Update: {
          attempts?: number
          base64?: string
          consultant_id?: string
          created_at?: string
          customer_id?: string
          expires_at?: string
          id?: number
          media_kind?: string
          message_id?: string
          mime_type?: string | null
          next_attempt_at?: string
          succeeded_at?: string | null
        }
        Relationships: []
      }
      infra_metrics: {
        Row: {
          created_at: string
          id: string
          meta: Json
          metric_key: string
          value_num: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          meta?: Json
          metric_key: string
          value_num?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          meta?: Json
          metric_key?: string
          value_num?: number | null
        }
        Relationships: []
      }
      instance_reconnect_cooldowns: {
        Row: {
          attempts: number
          created_at: string
          instance_name: string
          next_allowed_at: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          instance_name: string
          next_allowed_at: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          instance_name?: string
          next_allowed_at?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      instance_risk_signals: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          instance_name: string
          metadata: Json | null
          severity: string
          signal_type: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          instance_name: string
          metadata?: Json | null
          severity?: string
          signal_type: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          instance_name?: string
          metadata?: Json | null
          severity?: string
          signal_type?: string
        }
        Relationships: []
      }
      instance_send_counters: {
        Row: {
          created_at: string
          day: string
          first_send_at: string | null
          instance_name: string
          last_send_at: string | null
          sent_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          day: string
          first_send_at?: string | null
          instance_name: string
          last_send_at?: string | null
          sent_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          day?: string
          first_send_at?: string | null
          instance_name?: string
          last_send_at?: string | null
          sent_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      kanban_stages: {
        Row: {
          auto_message_enabled: boolean
          auto_message_image_url: string | null
          auto_message_media_url: string | null
          auto_message_text: string | null
          auto_message_type: string | null
          color: string
          consultant_id: string
          created_at: string
          id: string
          label: string
          position: number
          stage_key: string
          stage_scope: string
        }
        Insert: {
          auto_message_enabled?: boolean
          auto_message_image_url?: string | null
          auto_message_media_url?: string | null
          auto_message_text?: string | null
          auto_message_type?: string | null
          color?: string
          consultant_id: string
          created_at?: string
          id?: string
          label: string
          position?: number
          stage_key: string
          stage_scope?: string
        }
        Update: {
          auto_message_enabled?: boolean
          auto_message_image_url?: string | null
          auto_message_media_url?: string | null
          auto_message_text?: string | null
          auto_message_type?: string | null
          color?: string
          consultant_id?: string
          created_at?: string
          id?: string
          label?: string
          position?: number
          stage_key?: string
          stage_scope?: string
        }
        Relationships: []
      }
      lead_cadence_state: {
        Row: {
          attempts_by_channel: Json
          claim_attempts: number
          claim_token: string | null
          claimed_at: string | null
          consultant_id: string | null
          created_at: string
          customer_id: string
          id: string
          journey_started_at: string | null
          journey_version: number
          last_action_at: string | null
          last_effect_id: string | null
          last_response_at: string | null
          lease_expires_at: string | null
          next_action_at: string | null
          paused_reason: string | null
          paused_until: string | null
          retarget_enabled: boolean
          stage: Database["public"]["Enums"]["cadence_stage"]
          stage_entered_at: string | null
          stage_sequence: number
          temperature: string
          timezone: string
          updated_at: string
          won_at: string | null
        }
        Insert: {
          attempts_by_channel?: Json
          claim_attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          consultant_id?: string | null
          created_at?: string
          customer_id: string
          id?: string
          journey_started_at?: string | null
          journey_version?: number
          last_action_at?: string | null
          last_effect_id?: string | null
          last_response_at?: string | null
          lease_expires_at?: string | null
          next_action_at?: string | null
          paused_reason?: string | null
          paused_until?: string | null
          retarget_enabled?: boolean
          stage?: Database["public"]["Enums"]["cadence_stage"]
          stage_entered_at?: string | null
          stage_sequence?: number
          temperature?: string
          timezone?: string
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          attempts_by_channel?: Json
          claim_attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          consultant_id?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          journey_started_at?: string | null
          journey_version?: number
          last_action_at?: string | null
          last_effect_id?: string | null
          last_response_at?: string | null
          lease_expires_at?: string | null
          next_action_at?: string | null
          paused_reason?: string | null
          paused_until?: string | null
          retarget_enabled?: boolean
          stage?: Database["public"]["Enums"]["cadence_stage"]
          stage_entered_at?: string | null
          stage_sequence?: number
          temperature?: string
          timezone?: string
          updated_at?: string
          won_at?: string | null
        }
        Relationships: []
      }
      lead_consent_log: {
        Row: {
          channel: string
          consent_text: string
          consultant_id: string | null
          created_at: string
          id: string
          ip: unknown
          lead_id: string
          user_agent: string | null
        }
        Insert: {
          channel: string
          consent_text: string
          consultant_id?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          lead_id: string
          user_agent?: string | null
        }
        Update: {
          channel?: string
          consent_text?: string
          consultant_id?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          lead_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_consent_log_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "lead_consent_log_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_consent_log_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_consent_log_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "lead_consent_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "captured_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_insights: {
        Row: {
          classification_source: string | null
          classified_at: string
          consultant_id: string
          conversion_chance: number | null
          created_at: string
          customer_id: string
          loss_reason: string | null
          main_doubt: string | null
          main_objection: string | null
          messages_count_at_classify: number | null
          model_used: string | null
          needs_reclassify: boolean
          next_action: string | null
          next_msg_draft: string | null
          next_msg_template_shortcut: string | null
          signals: Json
          summary: string | null
          temperature: Database["public"]["Enums"]["lead_temperature"]
          tokens_used: number | null
          updated_at: string
        }
        Insert: {
          classification_source?: string | null
          classified_at?: string
          consultant_id: string
          conversion_chance?: number | null
          created_at?: string
          customer_id: string
          loss_reason?: string | null
          main_doubt?: string | null
          main_objection?: string | null
          messages_count_at_classify?: number | null
          model_used?: string | null
          needs_reclassify?: boolean
          next_action?: string | null
          next_msg_draft?: string | null
          next_msg_template_shortcut?: string | null
          signals?: Json
          summary?: string | null
          temperature?: Database["public"]["Enums"]["lead_temperature"]
          tokens_used?: number | null
          updated_at?: string
        }
        Update: {
          classification_source?: string | null
          classified_at?: string
          consultant_id?: string
          conversion_chance?: number | null
          created_at?: string
          customer_id?: string
          loss_reason?: string | null
          main_doubt?: string | null
          main_objection?: string | null
          messages_count_at_classify?: number | null
          model_used?: string | null
          needs_reclassify?: boolean
          next_action?: string | null
          next_msg_draft?: string | null
          next_msg_template_shortcut?: string | null
          signals?: Json
          summary?: string | null
          temperature?: Database["public"]["Enums"]["lead_temperature"]
          tokens_used?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_insights_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_research_sweep_cities: {
        Row: {
          city: string
          created_at: string
          deduped: number
          error: string | null
          found: number
          id: string
          ingested: number
          processed_at: string | null
          skipped: number
          status: string
          sweep_id: string
          uf: string
        }
        Insert: {
          city: string
          created_at?: string
          deduped?: number
          error?: string | null
          found?: number
          id?: string
          ingested?: number
          processed_at?: string | null
          skipped?: number
          status?: string
          sweep_id: string
          uf: string
        }
        Update: {
          city?: string
          created_at?: string
          deduped?: number
          error?: string | null
          found?: number
          id?: string
          ingested?: number
          processed_at?: string | null
          skipped?: number
          status?: string
          sweep_id?: string
          uf?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_research_sweep_cities_sweep_id_fkey"
            columns: ["sweep_id"]
            isOneToOne: false
            referencedRelation: "lead_research_sweeps"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_research_sweeps: {
        Row: {
          category: string
          consultant_id: string
          created_at: string
          deduped: number
          done_cities: number
          errors: number
          found_phones: number
          id: string
          ingested: number
          status: string
          total_cities: number
          uf: string
          updated_at: string
        }
        Insert: {
          category?: string
          consultant_id: string
          created_at?: string
          deduped?: number
          done_cities?: number
          errors?: number
          found_phones?: number
          id?: string
          ingested?: number
          status?: string
          total_cities?: number
          uf: string
          updated_at?: string
        }
        Update: {
          category?: string
          consultant_id?: string
          created_at?: string
          deduped?: number
          done_cities?: number
          errors?: number
          found_phones?: number
          id?: string
          ingested?: number
          status?: string
          total_cities?: number
          uf?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_research_sweeps_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "lead_research_sweeps_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_research_sweeps_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_research_sweeps_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      message_templates: {
        Row: {
          consultant_id: string
          content: string
          created_at: string | null
          id: string
          image_url: string | null
          is_public: boolean
          is_quick_reply: boolean
          media_type: string | null
          media_url: string | null
          name: string
          origin_template_id: string | null
          shortcut: string | null
        }
        Insert: {
          consultant_id: string
          content: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_public?: boolean
          is_quick_reply?: boolean
          media_type?: string | null
          media_url?: string | null
          name: string
          origin_template_id?: string | null
          shortcut?: string | null
        }
        Update: {
          consultant_id?: string
          content?: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_public?: boolean
          is_quick_reply?: boolean
          media_type?: string | null
          media_url?: string | null
          name?: string
          origin_template_id?: string | null
          shortcut?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_origin_template_id_fkey"
            columns: ["origin_template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_audience_sync_log: {
        Row: {
          audience_id: string | null
          consultant_id: string | null
          created_at: string
          customer_id: string | null
          detail: string | null
          id: string
          ok: boolean
          phone_ddd: string | null
          source: string
        }
        Insert: {
          audience_id?: string | null
          consultant_id?: string | null
          created_at?: string
          customer_id?: string | null
          detail?: string | null
          id?: string
          ok?: boolean
          phone_ddd?: string | null
          source?: string
        }
        Update: {
          audience_id?: string | null
          consultant_id?: string | null
          created_at?: string
          customer_id?: string | null
          detail?: string | null
          id?: string
          ok?: boolean
          phone_ddd?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_audience_sync_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      network_members: {
        Row: {
          bonificavel: number | null
          cidade: string | null
          clientes_ativos: number | null
          club_mes: number | null
          consultant_id: string
          data_ativo: string | null
          data_nascimento: string | null
          diretos_ativos: number | null
          diretos_inicio_rapido: number | null
          diretos_mes: number | null
          expansao_mes: number | null
          gi: number | null
          gi_mes: number | null
          gi_total: number | null
          gp: number | null
          gp_mes: number | null
          gp_total: number | null
          graduacao: string | null
          graduacao_expansao: string | null
          green_points: number | null
          green_points_ano: number | null
          green_points_mes: number | null
          green_telecom_mes: number | null
          gt_qualificavel: number | null
          id: string
          igreen_account_id: string | null
          igreen_id: number
          inicio_rapido: string | null
          licenciados_diretos: number | null
          licenciados_diretos_ativos: number | null
          livre_mes: number | null
          name: string
          nivel: number | null
          phone: string | null
          placas_mes: number | null
          pro: string | null
          produtos: Json | null
          qtde_diretos: number | null
          sponsor_id: number | null
          sponsor_override_id: number | null
          total_pontos: number | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          bonificavel?: number | null
          cidade?: string | null
          clientes_ativos?: number | null
          club_mes?: number | null
          consultant_id: string
          data_ativo?: string | null
          data_nascimento?: string | null
          diretos_ativos?: number | null
          diretos_inicio_rapido?: number | null
          diretos_mes?: number | null
          expansao_mes?: number | null
          gi?: number | null
          gi_mes?: number | null
          gi_total?: number | null
          gp?: number | null
          gp_mes?: number | null
          gp_total?: number | null
          graduacao?: string | null
          graduacao_expansao?: string | null
          green_points?: number | null
          green_points_ano?: number | null
          green_points_mes?: number | null
          green_telecom_mes?: number | null
          gt_qualificavel?: number | null
          id?: string
          igreen_account_id?: string | null
          igreen_id: number
          inicio_rapido?: string | null
          licenciados_diretos?: number | null
          licenciados_diretos_ativos?: number | null
          livre_mes?: number | null
          name: string
          nivel?: number | null
          phone?: string | null
          placas_mes?: number | null
          pro?: string | null
          produtos?: Json | null
          qtde_diretos?: number | null
          sponsor_id?: number | null
          sponsor_override_id?: number | null
          total_pontos?: number | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          bonificavel?: number | null
          cidade?: string | null
          clientes_ativos?: number | null
          club_mes?: number | null
          consultant_id?: string
          data_ativo?: string | null
          data_nascimento?: string | null
          diretos_ativos?: number | null
          diretos_inicio_rapido?: number | null
          diretos_mes?: number | null
          expansao_mes?: number | null
          gi?: number | null
          gi_mes?: number | null
          gi_total?: number | null
          gp?: number | null
          gp_mes?: number | null
          gp_total?: number | null
          graduacao?: string | null
          graduacao_expansao?: string | null
          green_points?: number | null
          green_points_ano?: number | null
          green_points_mes?: number | null
          green_telecom_mes?: number | null
          gt_qualificavel?: number | null
          id?: string
          igreen_account_id?: string | null
          igreen_id?: number
          inicio_rapido?: string | null
          licenciados_diretos?: number | null
          licenciados_diretos_ativos?: number | null
          livre_mes?: number | null
          name?: string
          nivel?: number | null
          phone?: string | null
          placas_mes?: number | null
          pro?: string | null
          produtos?: Json | null
          qtde_diretos?: number | null
          sponsor_id?: number | null
          sponsor_override_id?: number | null
          total_pontos?: number | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "network_members_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_blocked_log: {
        Row: {
          consultant_id: string
          context: Json | null
          created_at: string
          id: string
          instance_name: string | null
          reason: string
        }
        Insert: {
          consultant_id: string
          context?: Json | null
          created_at?: string
          id?: string
          instance_name?: string | null
          reason: string
        }
        Update: {
          consultant_id?: string
          context?: Json | null
          created_at?: string
          id?: string
          instance_name?: string | null
          reason?: string
        }
        Relationships: []
      }
      outbound_effects: {
        Row: {
          action_key: string | null
          attempt_count: number
          channel: string
          claim_id: string | null
          consultant_id: string | null
          customer_id: string | null
          delivered_at: string | null
          destination_hash: string | null
          engine_key: string
          error_code: string | null
          id: string
          idempotency_key: string
          journey_id: string | null
          meta: Json
          next_reconcile_at: string | null
          payload_hash: string | null
          provider: string | null
          provider_message_id: string | null
          provider_request_id: string | null
          provider_status: string | null
          reserved_at: string
          run_id: string | null
          sending_at: string | null
          sent_at: string | null
          stage: string | null
          stage_sequence: number | null
          status: string
          template_key: string | null
          template_version: string | null
          updated_at: string
        }
        Insert: {
          action_key?: string | null
          attempt_count?: number
          channel: string
          claim_id?: string | null
          consultant_id?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          destination_hash?: string | null
          engine_key: string
          error_code?: string | null
          id?: string
          idempotency_key: string
          journey_id?: string | null
          meta?: Json
          next_reconcile_at?: string | null
          payload_hash?: string | null
          provider?: string | null
          provider_message_id?: string | null
          provider_request_id?: string | null
          provider_status?: string | null
          reserved_at?: string
          run_id?: string | null
          sending_at?: string | null
          sent_at?: string | null
          stage?: string | null
          stage_sequence?: number | null
          status?: string
          template_key?: string | null
          template_version?: string | null
          updated_at?: string
        }
        Update: {
          action_key?: string | null
          attempt_count?: number
          channel?: string
          claim_id?: string | null
          consultant_id?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          destination_hash?: string | null
          engine_key?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string
          journey_id?: string | null
          meta?: Json
          next_reconcile_at?: string | null
          payload_hash?: string | null
          provider?: string | null
          provider_message_id?: string | null
          provider_request_id?: string | null
          provider_status?: string | null
          reserved_at?: string
          run_id?: string | null
          sending_at?: string | null
          sent_at?: string | null
          stage?: string | null
          stage_sequence?: number | null
          status?: string
          template_key?: string | null
          template_version?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      outbound_message_log: {
        Row: {
          consultant_id: string
          created_at: string
          customer_id: string | null
          evolution_message_id: string | null
          idempotency_key: string
          payload_hash: string
          result_status: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          evolution_message_id?: string | null
          idempotency_key: string
          payload_hash: string
          result_status?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          evolution_message_id?: string | null
          idempotency_key?: string
          payload_hash?: string
          result_status?: string | null
        }
        Relationships: []
      }
      page_events: {
        Row: {
          consultant_id: string
          created_at: string
          device_type: string | null
          event_target: string | null
          event_type: string
          id: string
          page_type: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          device_type?: string | null
          event_target?: string | null
          event_type?: string
          id?: string
          page_type?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          device_type?: string | null
          event_target?: string | null
          event_type?: string
          id?: string
          page_type?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_events_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "page_events_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_events_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_events_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      page_views: {
        Row: {
          consultant_id: string
          created_at: string
          device_type: string | null
          id: string
          page_type: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          device_type?: string | null
          id?: string
          page_type?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          device_type?: string | null
          id?: string
          page_type?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_views_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "page_views_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_views_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_views_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      partner_protocol_seq: {
        Row: {
          date_ymd: string
          partner_id: string
          seq: number
          updated_at: string
        }
        Insert: {
          date_ymd: string
          partner_id: string
          seq?: number
          updated_at?: string
        }
        Update: {
          date_ymd?: string
          partner_id?: string
          seq?: number
          updated_at?: string
        }
        Relationships: []
      }
      pending_outbound_media: {
        Row: {
          attempts: number
          consultant_id: string
          created_at: string
          customer_id: string
          id: number
          payload: Json
          scheduled_for: string
          succeeded_at: string | null
        }
        Insert: {
          attempts?: number
          consultant_id: string
          created_at?: string
          customer_id: string
          id?: number
          payload: Json
          scheduled_for?: string
          succeeded_at?: string | null
        }
        Update: {
          attempts?: number
          consultant_id?: string
          created_at?: string
          customer_id?: string
          id?: number
          payload?: Json
          scheduled_for?: string
          succeeded_at?: string | null
        }
        Relationships: []
      }
      phone_reset_quarantine: {
        Row: {
          created_at: string
          created_by: string | null
          phone_digits: string
          quarantine_until: string
          reset_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          phone_digits: string
          quarantine_until: string
          reset_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          phone_digits?: string
          quarantine_until?: string
          reset_at?: string
        }
        Relationships: []
      }
      platform_facebook_account: {
        Row: {
          access_token_encrypted: string
          ad_account_currency: string | null
          ad_account_id: string | null
          ad_account_name: string | null
          audience_source_count: number | null
          audience_synced_at: string | null
          business_id: string | null
          business_name: string | null
          created_at: string
          custom_audience_id: string | null
          fb_user_id: string | null
          fb_user_name: string | null
          id: boolean
          ig_account_id: string | null
          ig_account_username: string | null
          last_validated_at: string | null
          lookalike_audience_id: string | null
          page_id: string | null
          page_name: string | null
          pixel_id: string | null
          pixel_name: string | null
          retarget_ddd_allowlist: number[] | null
          status: string
          token_expires_at: string | null
          updated_at: string
          validation_errors: Json | null
        }
        Insert: {
          access_token_encrypted: string
          ad_account_currency?: string | null
          ad_account_id?: string | null
          ad_account_name?: string | null
          audience_source_count?: number | null
          audience_synced_at?: string | null
          business_id?: string | null
          business_name?: string | null
          created_at?: string
          custom_audience_id?: string | null
          fb_user_id?: string | null
          fb_user_name?: string | null
          id?: boolean
          ig_account_id?: string | null
          ig_account_username?: string | null
          last_validated_at?: string | null
          lookalike_audience_id?: string | null
          page_id?: string | null
          page_name?: string | null
          pixel_id?: string | null
          pixel_name?: string | null
          retarget_ddd_allowlist?: number[] | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          validation_errors?: Json | null
        }
        Update: {
          access_token_encrypted?: string
          ad_account_currency?: string | null
          ad_account_id?: string | null
          ad_account_name?: string | null
          audience_source_count?: number | null
          audience_synced_at?: string | null
          business_id?: string | null
          business_name?: string | null
          created_at?: string
          custom_audience_id?: string | null
          fb_user_id?: string | null
          fb_user_name?: string | null
          id?: boolean
          ig_account_id?: string | null
          ig_account_username?: string | null
          last_validated_at?: string | null
          lookalike_audience_id?: string | null
          page_id?: string | null
          page_name?: string | null
          pixel_id?: string | null
          pixel_name?: string | null
          retarget_ddd_allowlist?: number[] | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          validation_errors?: Json | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          campaign_safety_multiplier: number
          default_auto_pause_at_cents: number
          id: boolean
          iof_compensation_percent: number
          low_balance_alert_cents: number
          min_balance_to_create_campaign_cents: number
          platform_fee_percent: number
          updated_at: string
        }
        Insert: {
          campaign_safety_multiplier?: number
          default_auto_pause_at_cents?: number
          id?: boolean
          iof_compensation_percent?: number
          low_balance_alert_cents?: number
          min_balance_to_create_campaign_cents?: number
          platform_fee_percent?: number
          updated_at?: string
        }
        Update: {
          campaign_safety_multiplier?: number
          default_auto_pause_at_cents?: number
          id?: boolean
          iof_compensation_percent?: number
          low_balance_alert_cents?: number
          min_balance_to_create_campaign_cents?: number
          platform_fee_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      portal2_audit_traces: {
        Row: {
          ai_cost_usd: number | null
          ai_findings: Json | null
          ai_model: string | null
          ai_summary: string | null
          ai_tokens_in: number | null
          ai_tokens_out: number | null
          created_at: string
          customer_id: string | null
          duration_ms: number | null
          error: string | null
          id: string
          idconsultor: number | null
          input_summary: Json | null
          is_official_reference: boolean
          job_id: string | null
          official_label: string | null
          official_marked_at: string | null
          official_notes: string | null
          result: Json | null
          status: string
          trace: Json
        }
        Insert: {
          ai_cost_usd?: number | null
          ai_findings?: Json | null
          ai_model?: string | null
          ai_summary?: string | null
          ai_tokens_in?: number | null
          ai_tokens_out?: number | null
          created_at?: string
          customer_id?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          idconsultor?: number | null
          input_summary?: Json | null
          is_official_reference?: boolean
          job_id?: string | null
          official_label?: string | null
          official_marked_at?: string | null
          official_notes?: string | null
          result?: Json | null
          status: string
          trace?: Json
        }
        Update: {
          ai_cost_usd?: number | null
          ai_findings?: Json | null
          ai_model?: string | null
          ai_summary?: string | null
          ai_tokens_in?: number | null
          ai_tokens_out?: number | null
          created_at?: string
          customer_id?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          idconsultor?: number | null
          input_summary?: Json | null
          is_official_reference?: boolean
          job_id?: string | null
          official_label?: string | null
          official_marked_at?: string | null
          official_notes?: string | null
          result?: Json | null
          status?: string
          trace?: Json
        }
        Relationships: [
          {
            foreignKeyName: "portal2_audit_traces_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_venda_default_media: {
        Row: {
          image_url: string | null
          is_active: boolean
          media_url: string | null
          message_text: string | null
          message_type: string
          stage: string
          updated_at: string
        }
        Insert: {
          image_url?: string | null
          is_active?: boolean
          media_url?: string | null
          message_text?: string | null
          message_type?: string
          stage: string
          updated_at?: string
        }
        Update: {
          image_url?: string | null
          is_active?: boolean
          media_url?: string | null
          message_text?: string | null
          message_type?: string
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      proactive_touch_log: {
        Row: {
          claim_token: string | null
          created_at: string
          customer_id: string
          id: number
          lease_expires_at: string | null
          meta: Json
          source_key: string
          status: string
        }
        Insert: {
          claim_token?: string | null
          created_at?: string
          customer_id: string
          id?: number
          lease_expires_at?: string | null
          meta?: Json
          source_key: string
          status?: string
        }
        Update: {
          claim_token?: string | null
          created_at?: string
          customer_id?: string
          id?: number
          lease_expires_at?: string | null
          meta?: Json
          source_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "proactive_touch_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      production_health_snapshot: {
        Row: {
          active_variants: string[] | null
          capi_ok: boolean | null
          captured_at: string
          consultant_id: string
          errors: Json | null
          flows_missing: string[] | null
          flows_ok: boolean | null
          id: string
          instance_last_seen: string | null
          instance_status: string | null
          last_lead_at: string | null
          leads_24h: number | null
          notification_phone_ok: boolean | null
          pixel_ok: boolean | null
        }
        Insert: {
          active_variants?: string[] | null
          capi_ok?: boolean | null
          captured_at?: string
          consultant_id: string
          errors?: Json | null
          flows_missing?: string[] | null
          flows_ok?: boolean | null
          id?: string
          instance_last_seen?: string | null
          instance_status?: string | null
          last_lead_at?: string | null
          leads_24h?: number | null
          notification_phone_ok?: boolean | null
          pixel_ok?: boolean | null
        }
        Update: {
          active_variants?: string[] | null
          capi_ok?: boolean | null
          captured_at?: string
          consultant_id?: string
          errors?: Json | null
          flows_missing?: string[] | null
          flows_ok?: boolean | null
          id?: string
          instance_last_seen?: string | null
          instance_status?: string | null
          last_lead_at?: string | null
          leads_24h?: number | null
          notification_phone_ok?: boolean | null
          pixel_ok?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "production_health_snapshot_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "production_health_snapshot_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_health_snapshot_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_health_snapshot_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      products: {
        Row: {
          brand_name: string
          commission_rule: Json
          created_at: string
          family: Database["public"]["Enums"]["product_family"]
          id: string
          is_active: boolean
          landing_content: Json
          name: string
          scoring_rule: Json
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          brand_name: string
          commission_rule?: Json
          created_at?: string
          family: Database["public"]["Enums"]["product_family"]
          id?: string
          is_active?: boolean
          landing_content?: Json
          name: string
          scoring_rule?: Json
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          brand_name?: string
          commission_rule?: Json
          created_at?: string
          family?: Database["public"]["Enums"]["product_family"]
          id?: string
          is_active?: boolean
          landing_content?: Json
          name?: string
          scoring_rule?: Json
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      proposal_events: {
        Row: {
          actor: string
          attachment_url: string | null
          counter_amount_cents: number | null
          created_at: string
          id: string
          note: string | null
          proposal_id: string
          type: Database["public"]["Enums"]["proposal_event_type"]
        }
        Insert: {
          actor?: string
          attachment_url?: string | null
          counter_amount_cents?: number | null
          created_at?: string
          id?: string
          note?: string | null
          proposal_id: string
          type: Database["public"]["Enums"]["proposal_event_type"]
        }
        Update: {
          actor?: string
          attachment_url?: string | null
          counter_amount_cents?: number | null
          created_at?: string
          id?: string
          note?: string | null
          proposal_id?: string
          type?: Database["public"]["Enums"]["proposal_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "proposal_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          amount_cents: number | null
          amount_period: string
          consultant_id: string
          created_at: string
          customer_id: string | null
          discount_cents: number | null
          id: string
          line_items: Json
          message: string | null
          product_id: string
          public_token: string
          recipient_name: string | null
          recipient_phone: string | null
          responded_at: string | null
          sale_id: string | null
          sent_at: string | null
          solar_snapshot_id: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          updated_at: string
          valid_until: string | null
          viewed_at: string | null
        }
        Insert: {
          amount_cents?: number | null
          amount_period?: string
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          discount_cents?: number | null
          id?: string
          line_items?: Json
          message?: string | null
          product_id: string
          public_token?: string
          recipient_name?: string | null
          recipient_phone?: string | null
          responded_at?: string | null
          sale_id?: string | null
          sent_at?: string | null
          solar_snapshot_id?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
          valid_until?: string | null
          viewed_at?: string | null
        }
        Update: {
          amount_cents?: number | null
          amount_period?: string
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          discount_cents?: number | null
          id?: string
          line_items?: Json
          message?: string | null
          product_id?: string
          public_token?: string
          recipient_name?: string | null
          recipient_phone?: string | null
          responded_at?: string | null
          sale_id?: string | null
          sent_at?: string | null
          solar_snapshot_id?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
          valid_until?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "proposals_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "proposals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_solar_snapshot_id_fkey"
            columns: ["solar_snapshot_id"]
            isOneToOne: false
            referencedRelation: "solar_design_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      reactivation_sends: {
        Row: {
          batch_id: string | null
          consultant_id: string
          conversation_step: string | null
          customer_id: string
          error_reason: string | null
          id: string
          message_text: string
          outcome: string | null
          sent_at: string
          status: string
          template_id: string | null
          trigger_type: string
        }
        Insert: {
          batch_id?: string | null
          consultant_id: string
          conversation_step?: string | null
          customer_id: string
          error_reason?: string | null
          id?: string
          message_text: string
          outcome?: string | null
          sent_at?: string
          status?: string
          template_id?: string | null
          trigger_type?: string
        }
        Update: {
          batch_id?: string | null
          consultant_id?: string
          conversation_step?: string | null
          customer_id?: string
          error_reason?: string | null
          id?: string
          message_text?: string
          outcome?: string | null
          sent_at?: string
          status?: string
          template_id?: string | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactivation_sends_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactivation_sends_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "reactivation_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      reactivation_settings: {
        Row: {
          auto_enabled: boolean
          consultant_id: string
          enviar_fim_de_semana: boolean
          horas_ate_primeiro_followup: number
          horas_entre_envios: number
          janela_fim: number
          janela_inicio: number
          max_envios: number
          updated_at: string
        }
        Insert: {
          auto_enabled?: boolean
          consultant_id: string
          enviar_fim_de_semana?: boolean
          horas_ate_primeiro_followup?: number
          horas_entre_envios?: number
          janela_fim?: number
          janela_inicio?: number
          max_envios?: number
          updated_at?: string
        }
        Update: {
          auto_enabled?: boolean
          consultant_id?: string
          enviar_fim_de_semana?: boolean
          horas_ate_primeiro_followup?: number
          horas_entre_envios?: number
          janela_fim?: number
          janela_inicio?: number
          max_envios?: number
          updated_at?: string
        }
        Relationships: []
      }
      reactivation_templates: {
        Row: {
          auto_reactivate: boolean
          consultant_id: string
          conversation_step: string
          created_at: string
          id: string
          is_active: boolean
          media_kind: string | null
          media_url: string | null
          message_text: string
          send_order: number
          updated_at: string
        }
        Insert: {
          auto_reactivate?: boolean
          consultant_id: string
          conversation_step: string
          created_at?: string
          id?: string
          is_active?: boolean
          media_kind?: string | null
          media_url?: string | null
          message_text: string
          send_order?: number
          updated_at?: string
        }
        Update: {
          auto_reactivate?: boolean
          consultant_id?: string
          conversation_step?: string
          created_at?: string
          id?: string
          is_active?: boolean
          media_kind?: string | null
          media_url?: string | null
          message_text?: string
          send_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      referral_partners: {
        Row: {
          cli: string | null
          consultant_id: string
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          nome: string
          notification_phone: string | null
          partner_igreen_id: string | null
          protocol_seq: number
          qr_phrase: string | null
          rodizio_metrics_enabled: boolean
          short_code: string | null
          updated_at: string
        }
        Insert: {
          cli?: string | null
          consultant_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          nome: string
          notification_phone?: string | null
          partner_igreen_id?: string | null
          protocol_seq?: number
          qr_phrase?: string | null
          rodizio_metrics_enabled?: boolean
          short_code?: string | null
          updated_at?: string
        }
        Update: {
          cli?: string | null
          consultant_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          nome?: string
          notification_phone?: string | null
          partner_igreen_id?: string | null
          protocol_seq?: number
          qr_phrase?: string | null
          rodizio_metrics_enabled?: boolean
          short_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_partners_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "referral_partners_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_partners_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_partners_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      remote_support_codes: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          id: string
          max_attempts: number
          rotates_at: string
          session_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          max_attempts?: number
          rotates_at: string
          session_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          max_attempts?: number
          rotates_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remote_support_codes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "remote_support_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_support_logs: {
        Row: {
          action: string
          actor: string
          created_at: string
          id: string
          payload: Json | null
          session_id: string
          target: string | null
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          id?: string
          payload?: Json | null
          session_id: string
          target?: string | null
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          id?: string
          payload?: Json | null
          session_id?: string
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remote_support_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "remote_support_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_support_sessions: {
        Row: {
          created_at: string
          end_reason: string | null
          ended_at: string | null
          id: string
          initiated_by: string
          ip_operator: string | null
          ip_requester: string | null
          operator_id: string | null
          requester_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          initiated_by?: string
          ip_operator?: string | null
          ip_requester?: string | null
          operator_id?: string | null
          requester_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          initiated_by?: string
          ip_operator?: string | null
          ip_requester?: string | null
          operator_id?: string | null
          requester_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      retention_settings: {
        Row: {
          call_answered_pause_hours: number
          id: string
          orchestrator_cooldown_hours: number
          portal_abandon_hours: number
          priority_order: Json
          speed_to_lead_minutes: number
          updated_at: string
        }
        Insert: {
          call_answered_pause_hours?: number
          id?: string
          orchestrator_cooldown_hours?: number
          portal_abandon_hours?: number
          priority_order?: Json
          speed_to_lead_minutes?: number
          updated_at?: string
        }
        Update: {
          call_answered_pause_hours?: number
          id?: string
          orchestrator_cooldown_hours?: number
          portal_abandon_hours?: number
          priority_order?: Json
          speed_to_lead_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      rodizio_assignments: {
        Row: {
          assigned_at: string
          campaign_id: string
          consultant_id: string
          customer_id: string
          id: string
          partner_id: string
          pool_id: string
        }
        Insert: {
          assigned_at?: string
          campaign_id: string
          consultant_id: string
          customer_id: string
          id?: string
          partner_id: string
          pool_id: string
        }
        Update: {
          assigned_at?: string
          campaign_id?: string
          consultant_id?: string
          customer_id?: string
          id?: string
          partner_id?: string
          pool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rodizio_assignments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "facebook_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_assignments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "rodizio_assignments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_assignments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_assignments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "rodizio_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_assignments_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_assignments_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "rodizio_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      rodizio_pool_members: {
        Row: {
          created_at: string
          id: string
          lead_count: number
          partner_id: string
          pool_id: string
          position: number
          protocol_suffix: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lead_count?: number
          partner_id: string
          pool_id: string
          position: number
          protocol_suffix?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lead_count?: number
          partner_id?: string
          pool_id?: string
          position?: number
          protocol_suffix?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rodizio_pool_members_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "referral_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_pool_members_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "rodizio_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      rodizio_pools: {
        Row: {
          approval_notified_at: string | null
          campaign_id: string | null
          consultant_id: string | null
          counter: number
          created_at: string
          id: string
          is_active: boolean
          is_enabled: boolean
          label: string
          last_pause_reason: string | null
          message: string | null
          metrics_broadcast_interval_minutes: number
          metrics_quiet_end_hour: number
          metrics_quiet_start_hour: number
          paused_notified_at: string | null
          phones: string[] | null
          slug: string | null
          updated_at: string
        }
        Insert: {
          approval_notified_at?: string | null
          campaign_id?: string | null
          consultant_id?: string | null
          counter?: number
          created_at?: string
          id?: string
          is_active?: boolean
          is_enabled?: boolean
          label?: string
          last_pause_reason?: string | null
          message?: string | null
          metrics_broadcast_interval_minutes?: number
          metrics_quiet_end_hour?: number
          metrics_quiet_start_hour?: number
          paused_notified_at?: string | null
          phones?: string[] | null
          slug?: string | null
          updated_at?: string
        }
        Update: {
          approval_notified_at?: string | null
          campaign_id?: string | null
          consultant_id?: string | null
          counter?: number
          created_at?: string
          id?: string
          is_active?: boolean
          is_enabled?: boolean
          label?: string
          last_pause_reason?: string | null
          message?: string | null
          metrics_broadcast_interval_minutes?: number
          metrics_quiet_end_hour?: number
          metrics_quiet_start_hour?: number
          paused_notified_at?: string | null
          phones?: string[] | null
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rodizio_pools_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "facebook_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_pools_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "rodizio_pools_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_pools_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rodizio_pools_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      rollout_alerts: {
        Row: {
          acknowledged: boolean
          body: string
          consultant_id: string | null
          created_at: string
          id: string
          level: string
          title: string
        }
        Insert: {
          acknowledged?: boolean
          body: string
          consultant_id?: string | null
          created_at?: string
          id?: string
          level?: string
          title: string
        }
        Update: {
          acknowledged?: boolean
          body?: string
          consultant_id?: string | null
          created_at?: string
          id?: string
          level?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "rollout_alerts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "rollout_alerts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rollout_alerts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rollout_alerts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      rollout_audit: {
        Row: {
          consultant_id: string | null
          created_at: string
          flag_kind: string
          from_state: string | null
          id: string
          metrics_snapshot: Json | null
          reason: string | null
          to_state: string
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string
          flag_kind: string
          from_state?: string | null
          id?: string
          metrics_snapshot?: Json | null
          reason?: string | null
          to_state: string
        }
        Update: {
          consultant_id?: string | null
          created_at?: string
          flag_kind?: string
          from_state?: string | null
          id?: string
          metrics_snapshot?: Json | null
          reason?: string | null
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "rollout_audit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "rollout_audit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rollout_audit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rollout_audit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      rollout_config: {
        Row: {
          alert_consultant_id: string | null
          autopilot_enabled: boolean
          canary_min_hours: number
          canary_percent: number
          cerebro_min_coincidencia_pct: number
          cerebro_min_turnos: number
          cerebro_numeros_teste: string | null
          dark_min_hours: number
          green_max_delegated_ratio: number
          green_max_paused_ratio: number
          green_min_turns_24h: number
          id: boolean
          notes: string | null
          updated_at: string
        }
        Insert: {
          alert_consultant_id?: string | null
          autopilot_enabled?: boolean
          canary_min_hours?: number
          canary_percent?: number
          cerebro_min_coincidencia_pct?: number
          cerebro_min_turnos?: number
          cerebro_numeros_teste?: string | null
          dark_min_hours?: number
          green_max_delegated_ratio?: number
          green_max_paused_ratio?: number
          green_min_turns_24h?: number
          id?: boolean
          notes?: string | null
          updated_at?: string
        }
        Update: {
          alert_consultant_id?: string | null
          autopilot_enabled?: boolean
          canary_min_hours?: number
          canary_percent?: number
          cerebro_min_coincidencia_pct?: number
          cerebro_min_turnos?: number
          cerebro_numeros_teste?: string | null
          dark_min_hours?: number
          green_max_delegated_ratio?: number
          green_max_paused_ratio?: number
          green_min_turns_24h?: number
          id?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rollout_config_alert_consultant_id_fkey"
            columns: ["alert_consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "rollout_config_alert_consultant_id_fkey"
            columns: ["alert_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rollout_config_alert_consultant_id_fkey"
            columns: ["alert_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rollout_config_alert_consultant_id_fkey"
            columns: ["alert_consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      sale_stage_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime: string
          sale_stage_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime: string
          sale_stage_id: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime?: string
          sale_stage_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_stage_attachments_sale_stage_id_fkey"
            columns: ["sale_stage_id"]
            isOneToOne: false
            referencedRelation: "sale_stage_progress"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_stage_progress: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          name_snapshot: string
          note: string | null
          sale_id: string
          status: Database["public"]["Enums"]["sale_stage_status"]
          template_position: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          name_snapshot: string
          note?: string | null
          sale_id: string
          status?: Database["public"]["Enums"]["sale_stage_status"]
          template_position: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          name_snapshot?: string
          note?: string | null
          sale_id?: string
          status?: Database["public"]["Enums"]["sale_stage_status"]
          template_position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_stage_progress_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_stage_templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          position: number
          product_family: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          position: number
          product_family?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          product_family?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sale_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["sale_status"] | null
          id: string
          note: string | null
          sale_id: string
          to_status: Database["public"]["Enums"]["sale_status"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["sale_status"] | null
          id?: string
          note?: string | null
          sale_id: string
          to_status: Database["public"]["Enums"]["sale_status"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["sale_status"] | null
          id?: string
          note?: string | null
          sale_id?: string
          to_status?: Database["public"]["Enums"]["sale_status"]
        }
        Relationships: [
          {
            foreignKeyName: "sale_status_history_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          activated_at: string | null
          amount_cents: number | null
          capture_data: Json
          closed_at: string | null
          consultant_id: string
          created_at: string
          customer_id: string | null
          id: string
          lost_reason: string | null
          notes: string | null
          outcome: string | null
          points_kwh: number
          product_id: string
          source_id: string | null
          source_kind: string | null
          status: Database["public"]["Enums"]["sale_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          amount_cents?: number | null
          capture_data?: Json
          closed_at?: string | null
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          outcome?: string | null
          points_kwh?: number
          product_id: string
          source_id?: string | null
          source_kind?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          amount_cents?: number | null
          capture_data?: Json
          closed_at?: string | null
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          outcome?: string | null
          points_kwh?: number
          product_id?: string
          source_id?: string | null
          source_kind?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "sales_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages: {
        Row: {
          attempt_count: number
          canceled_at: string | null
          canceled_by: string | null
          consultant_id: string
          created_at: string
          created_by: string | null
          id: string
          instance_name: string
          last_error: string | null
          message_text: string
          processing_started_at: string | null
          remote_jid: string
          scheduled_at: string
          sent_at: string | null
          source_step_id: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          canceled_at?: string | null
          canceled_by?: string | null
          consultant_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          instance_name: string
          last_error?: string | null
          message_text: string
          processing_started_at?: string | null
          remote_jid: string
          scheduled_at: string
          sent_at?: string | null
          source_step_id?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          canceled_at?: string | null
          canceled_by?: string | null
          consultant_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          instance_name?: string
          last_error?: string | null
          message_text?: string
          processing_started_at?: string | null
          remote_jid?: string
          scheduled_at?: string
          sent_at?: string | null
          source_step_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_source_step_id_fkey"
            columns: ["source_step_id"]
            isOneToOne: false
            referencedRelation: "bot_flow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value?: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      silent_step_reset_log: {
        Row: {
          app_name: string | null
          created_at: string
          customer_id: string
          from_step: string
          id: string
          to_step: string
          txid: number | null
        }
        Insert: {
          app_name?: string | null
          created_at?: string
          customer_id: string
          from_step: string
          id?: string
          to_step: string
          txid?: number | null
        }
        Update: {
          app_name?: string | null
          created_at?: string
          customer_id?: string
          from_step?: string
          id?: string
          to_step?: string
          txid?: number | null
        }
        Relationships: []
      }
      solar_api_usage_log: {
        Row: {
          cache_hit: boolean
          consultant_id: string | null
          created_at: string
          endpoint: string
          error_code: string | null
          id: string
          latency_ms: number | null
        }
        Insert: {
          cache_hit?: boolean
          consultant_id?: string | null
          created_at?: string
          endpoint: string
          error_code?: string | null
          id?: string
          latency_ms?: number | null
        }
        Update: {
          cache_hit?: boolean
          consultant_id?: string | null
          created_at?: string
          endpoint?: string
          error_code?: string | null
          id?: string
          latency_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "solar_api_usage_log_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "solar_api_usage_log_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solar_api_usage_log_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solar_api_usage_log_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      solar_design_snapshots: {
        Row: {
          analysis_id: string
          consultant_id: string
          created_at: string
          id: string
          is_primary: boolean
          label: string | null
          manual_sketch: Json | null
          monthly_savings_cents: number | null
          panel_positions: Json
          panels_count: number
          preview_image_path: string | null
          roof_segments: Json
          sales_blurb: string | null
          system_kwp: number
          updated_at: string
          yearly_energy_kwh: number | null
        }
        Insert: {
          analysis_id: string
          consultant_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          manual_sketch?: Json | null
          monthly_savings_cents?: number | null
          panel_positions?: Json
          panels_count: number
          preview_image_path?: string | null
          roof_segments?: Json
          sales_blurb?: string | null
          system_kwp: number
          updated_at?: string
          yearly_energy_kwh?: number | null
        }
        Update: {
          analysis_id?: string
          consultant_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          manual_sketch?: Json | null
          monthly_savings_cents?: number | null
          panel_positions?: Json
          panels_count?: number
          preview_image_path?: string | null
          roof_segments?: Json
          sales_blurb?: string | null
          system_kwp?: number
          updated_at?: string
          yearly_energy_kwh?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "solar_design_snapshots_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "solar_roof_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solar_design_snapshots_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "solar_design_snapshots_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solar_design_snapshots_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solar_design_snapshots_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      solar_public_rate_limit: {
        Row: {
          count: number
          day: string
          ip_hash: string
        }
        Insert: {
          count?: number
          day?: string
          ip_hash: string
        }
        Update: {
          count?: number
          day?: string
          ip_hash?: string
        }
        Relationships: []
      }
      solar_roof_analyses: {
        Row: {
          address_text: string | null
          building_insights: Json
          cache_key: string
          consultant_id: string
          created_at: string
          customer_id: string | null
          data_layers: Json | null
          expires_at: string
          hd_bounds: Json | null
          hd_image_path: string | null
          id: string
          imagery_date: string | null
          imagery_quality: string
          imagery_view: Json | null
          latitude: number
          longitude: number
          max_panels: number | null
          max_yearly_kwh: number | null
          panel_watts: number | null
          source: string
        }
        Insert: {
          address_text?: string | null
          building_insights: Json
          cache_key: string
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          data_layers?: Json | null
          expires_at: string
          hd_bounds?: Json | null
          hd_image_path?: string | null
          id?: string
          imagery_date?: string | null
          imagery_quality?: string
          imagery_view?: Json | null
          latitude: number
          longitude: number
          max_panels?: number | null
          max_yearly_kwh?: number | null
          panel_watts?: number | null
          source?: string
        }
        Update: {
          address_text?: string | null
          building_insights?: Json
          cache_key?: string
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          data_layers?: Json | null
          expires_at?: string
          hd_bounds?: Json | null
          hd_image_path?: string | null
          id?: string
          imagery_date?: string | null
          imagery_quality?: string
          imagery_view?: Json | null
          latitude?: number
          longitude?: number
          max_panels?: number | null
          max_yearly_kwh?: number | null
          panel_watts?: number | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "solar_roof_analyses_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "solar_roof_analyses_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solar_roof_analyses_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solar_roof_analyses_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "solar_roof_analyses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_auto_messages: {
        Row: {
          consultant_id: string
          created_at: string
          deal_origin: string | null
          delay_seconds: number
          id: string
          image_url: string | null
          media_url: string | null
          message_text: string | null
          message_type: string
          position: number
          rejection_reason: string | null
          stage_id: string
          voice_template_id: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          deal_origin?: string | null
          delay_seconds?: number
          id?: string
          image_url?: string | null
          media_url?: string | null
          message_text?: string | null
          message_type?: string
          position?: number
          rejection_reason?: string | null
          stage_id: string
          voice_template_id?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          deal_origin?: string | null
          delay_seconds?: number
          id?: string
          image_url?: string | null
          media_url?: string | null
          message_text?: string | null
          message_type?: string
          position?: number
          rejection_reason?: string | null
          stage_id?: string
          voice_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_auto_messages_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "kanban_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_auto_messages_voice_template_id_fkey"
            columns: ["voice_template_id"]
            isOneToOne: false
            referencedRelation: "voice_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_migration_log: {
        Row: {
          attempts: number
          completed_at: string | null
          consultant_id: string | null
          created_at: string
          customer_jid: string | null
          error: string | null
          id: string
          media_kind: string | null
          size_bytes: number | null
          source_bucket: string
          source_path: string
          source_url: string | null
          started_at: string | null
          status: string
          target_object_key: string | null
          target_url: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          consultant_id?: string | null
          created_at?: string
          customer_jid?: string | null
          error?: string | null
          id?: string
          media_kind?: string | null
          size_bytes?: number | null
          source_bucket: string
          source_path: string
          source_url?: string | null
          started_at?: string | null
          status?: string
          target_object_key?: string | null
          target_url?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          consultant_id?: string | null
          created_at?: string
          customer_jid?: string | null
          error?: string | null
          id?: string
          media_kind?: string | null
          size_bytes?: number | null
          source_bucket?: string
          source_path?: string
          source_url?: string | null
          started_at?: string | null
          status?: string
          target_object_key?: string | null
          target_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      support_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      template_items: {
        Row: {
          created_at: string
          delay_seconds: number
          id: string
          image_url: string | null
          media_url: string | null
          message_text: string | null
          message_type: string
          position: number
          template_id: string
        }
        Insert: {
          created_at?: string
          delay_seconds?: number
          id?: string
          image_url?: string | null
          media_url?: string | null
          message_text?: string | null
          message_type?: string
          position?: number
          template_id: string
        }
        Update: {
          created_at?: string
          delay_seconds?: number
          id?: string
          image_url?: string | null
          media_url?: string | null
          message_text?: string | null
          message_type?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_articles: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          is_active: boolean
          order_index: number
          related_tour_step_id: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          body?: string
          category: string
          created_at?: string
          id?: string
          is_active?: boolean
          order_index?: number
          related_tour_step_id?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          order_index?: number
          related_tour_step_id?: string | null
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tour_articles_related_tour_step_id_fkey"
            columns: ["related_tour_step_id"]
            isOneToOne: false
            referencedRelation: "tour_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_steps: {
        Row: {
          body: string
          created_at: string
          cta_href: string | null
          cta_label: string | null
          id: string
          is_active: boolean
          order_index: number
          route: string
          selector: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          cta_href?: string | null
          cta_label?: string | null
          id?: string
          is_active?: boolean
          order_index: number
          route: string
          selector?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          cta_href?: string | null
          cta_label?: string | null
          id?: string
          is_active?: boolean
          order_index?: number
          route?: string
          selector?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_tour_progress: {
        Row: {
          completed_at: string | null
          current_step: number
          dismissed_at: string | null
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          current_step?: number
          dismissed_at?: string | null
          started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          current_step?: number
          dismissed_at?: string | null
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      voice_audio_clips: {
        Row: {
          audio_url: string
          consultant_id: string
          created_at: string
          duration_sec: number | null
          id: string
          is_call_body: boolean
          model_id: string | null
          name: string
          source_audio_library_id: string | null
          updated_at: string
          velip_audio_id: string | null
          velip_uploaded_at: string | null
          voice_id: string | null
        }
        Insert: {
          audio_url: string
          consultant_id: string
          created_at?: string
          duration_sec?: number | null
          id?: string
          is_call_body?: boolean
          model_id?: string | null
          name?: string
          source_audio_library_id?: string | null
          updated_at?: string
          velip_audio_id?: string | null
          velip_uploaded_at?: string | null
          voice_id?: string | null
        }
        Update: {
          audio_url?: string
          consultant_id?: string
          created_at?: string
          duration_sec?: number | null
          id?: string
          is_call_body?: boolean
          model_id?: string | null
          name?: string
          source_audio_library_id?: string | null
          updated_at?: string
          velip_audio_id?: string | null
          velip_uploaded_at?: string | null
          voice_id?: string | null
        }
        Relationships: []
      }
      voice_call_logs: {
        Row: {
          answered_by: string | null
          campaign_id: string | null
          consultant_id: string
          created_at: string
          dtmf_responses: Json
          duration_sec: number | null
          error: string | null
          from_phone: string | null
          id: string
          price: string | null
          price_per_min: number | null
          raw: Json
          status: string | null
          target_id: string | null
          to_phone: string
          twilio_sid: string | null
          velip_call_id: string | null
          velip_cost: number | null
          velip_dtmf: Json | null
          velip_raw: Json | null
          velip_saldo_after: number | null
          velip_status: string | null
          velip_time_sec: number | null
        }
        Insert: {
          answered_by?: string | null
          campaign_id?: string | null
          consultant_id: string
          created_at?: string
          dtmf_responses?: Json
          duration_sec?: number | null
          error?: string | null
          from_phone?: string | null
          id?: string
          price?: string | null
          price_per_min?: number | null
          raw?: Json
          status?: string | null
          target_id?: string | null
          to_phone: string
          twilio_sid?: string | null
          velip_call_id?: string | null
          velip_cost?: number | null
          velip_dtmf?: Json | null
          velip_raw?: Json | null
          velip_saldo_after?: number | null
          velip_status?: string | null
          velip_time_sec?: number | null
        }
        Update: {
          answered_by?: string | null
          campaign_id?: string | null
          consultant_id?: string
          created_at?: string
          dtmf_responses?: Json
          duration_sec?: number | null
          error?: string | null
          from_phone?: string | null
          id?: string
          price?: string | null
          price_per_min?: number | null
          raw?: Json
          status?: string | null
          target_id?: string | null
          to_phone?: string
          twilio_sid?: string | null
          velip_call_id?: string | null
          velip_cost?: number | null
          velip_dtmf?: Json | null
          velip_raw?: Json | null
          velip_saldo_after?: number | null
          velip_status?: string | null
          velip_time_sec?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_call_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "voice_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_call_logs_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "voice_campaign_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_call_renders: {
        Row: {
          body_clip_id: string
          consultant_id: string
          created_at: string
          display_name: string | null
          final_audio_url: string | null
          id: string
          intro_audio_url: string | null
          model_id: string
          name_normalized: string
          updated_at: string
          velip_audio_id: string | null
          voice_id: string
        }
        Insert: {
          body_clip_id: string
          consultant_id: string
          created_at?: string
          display_name?: string | null
          final_audio_url?: string | null
          id?: string
          intro_audio_url?: string | null
          model_id?: string
          name_normalized: string
          updated_at?: string
          velip_audio_id?: string | null
          voice_id: string
        }
        Update: {
          body_clip_id?: string
          consultant_id?: string
          created_at?: string
          display_name?: string | null
          final_audio_url?: string | null
          id?: string
          intro_audio_url?: string | null
          model_id?: string
          name_normalized?: string
          updated_at?: string
          velip_audio_id?: string | null
          voice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_call_renders_body_clip_id_fkey"
            columns: ["body_clip_id"]
            isOneToOne: false
            referencedRelation: "voice_audio_clips"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_campaign_targets: {
        Row: {
          answered_by: string | null
          attempts: number
          campaign_id: string
          created_at: string
          customer_id: string | null
          dialed_at: string | null
          error: string | null
          fallback_sms_at: string | null
          fallback_sms_effect_id: string | null
          finished_at: string | null
          id: string
          max_attempts: number
          name: string | null
          next_attempt_at: string | null
          phone: string
          status: string
          twilio_sid: string | null
          velip_call_id: string | null
          velip_cost: number | null
          velip_saldo_after: number | null
          velip_status: string | null
        }
        Insert: {
          answered_by?: string | null
          attempts?: number
          campaign_id: string
          created_at?: string
          customer_id?: string | null
          dialed_at?: string | null
          error?: string | null
          fallback_sms_at?: string | null
          fallback_sms_effect_id?: string | null
          finished_at?: string | null
          id?: string
          max_attempts?: number
          name?: string | null
          next_attempt_at?: string | null
          phone: string
          status?: string
          twilio_sid?: string | null
          velip_call_id?: string | null
          velip_cost?: number | null
          velip_saldo_after?: number | null
          velip_status?: string | null
        }
        Update: {
          answered_by?: string | null
          attempts?: number
          campaign_id?: string
          created_at?: string
          customer_id?: string | null
          dialed_at?: string | null
          error?: string | null
          fallback_sms_at?: string | null
          fallback_sms_effect_id?: string | null
          finished_at?: string | null
          id?: string
          max_attempts?: number
          name?: string | null
          next_attempt_at?: string | null
          phone?: string
          status?: string
          twilio_sid?: string | null
          velip_call_id?: string | null
          velip_cost?: number | null
          velip_saldo_after?: number | null
          velip_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "voice_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_campaigns: {
        Row: {
          answered: number
          audio_clip_id: string | null
          audio_url: string
          caller_id: string | null
          config: Json
          consultant_id: string
          created_at: string
          dialed: number
          dispatch_kind: string
          dtmf_questions: Json
          failed: number
          finished_at: string | null
          id: string
          logical_key: string | null
          name: string
          scheduled_at: string | null
          sms_on_no_answer_text: string | null
          started_at: string | null
          status: string
          total: number
          tts_text: string | null
          tts_voice: string | null
          updated_at: string
          velip_base_id: string | null
          velip_campaign_id: string | null
          velip_mode: string
        }
        Insert: {
          answered?: number
          audio_clip_id?: string | null
          audio_url: string
          caller_id?: string | null
          config?: Json
          consultant_id: string
          created_at?: string
          dialed?: number
          dispatch_kind?: string
          dtmf_questions?: Json
          failed?: number
          finished_at?: string | null
          id?: string
          logical_key?: string | null
          name?: string
          scheduled_at?: string | null
          sms_on_no_answer_text?: string | null
          started_at?: string | null
          status?: string
          total?: number
          tts_text?: string | null
          tts_voice?: string | null
          updated_at?: string
          velip_base_id?: string | null
          velip_campaign_id?: string | null
          velip_mode?: string
        }
        Update: {
          answered?: number
          audio_clip_id?: string | null
          audio_url?: string
          caller_id?: string | null
          config?: Json
          consultant_id?: string
          created_at?: string
          dialed?: number
          dispatch_kind?: string
          dtmf_questions?: Json
          failed?: number
          finished_at?: string | null
          id?: string
          logical_key?: string | null
          name?: string
          scheduled_at?: string | null
          sms_on_no_answer_text?: string | null
          started_at?: string | null
          status?: string
          total?: number
          tts_text?: string | null
          tts_voice?: string | null
          updated_at?: string
          velip_base_id?: string | null
          velip_campaign_id?: string | null
          velip_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_campaigns_audio_clip_id_fkey"
            columns: ["audio_clip_id"]
            isOneToOne: false
            referencedRelation: "voice_audio_clips"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_contact_base_items: {
        Row: {
          base_id: string
          created_at: string
          id: string
          name: string | null
          phone: string
          vars: Json
        }
        Insert: {
          base_id: string
          created_at?: string
          id?: string
          name?: string | null
          phone: string
          vars?: Json
        }
        Update: {
          base_id?: string
          created_at?: string
          id?: string
          name?: string | null
          phone?: string
          vars?: Json
        }
        Relationships: [
          {
            foreignKeyName: "voice_contact_base_items_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "voice_contact_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_contact_bases: {
        Row: {
          consultant_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          total: number
          updated_at: string
          velip_base_id: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          total?: number
          updated_at?: string
          velip_base_id?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          total?: number
          updated_at?: string
          velip_base_id?: string | null
        }
        Relationships: []
      }
      voice_dnc_list: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          phone: string
          reason: string | null
          source: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          phone: string
          reason?: string | null
          source?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          phone?: string
          reason?: string | null
          source?: string | null
        }
        Relationships: []
      }
      voice_name_clips: {
        Row: {
          audio_url: string
          consultant_id: string
          created_at: string
          id: string
          name_display: string
          name_normalized: string
          updated_at: string
        }
        Insert: {
          audio_url: string
          consultant_id: string
          created_at?: string
          id?: string
          name_display: string
          name_normalized: string
          updated_at?: string
        }
        Update: {
          audio_url?: string
          consultant_id?: string
          created_at?: string
          id?: string
          name_display?: string
          name_normalized?: string
          updated_at?: string
        }
        Relationships: []
      }
      voice_sms_log: {
        Row: {
          balance_after: number | null
          campaign_id: string | null
          consultant_id: string
          cost: number | null
          created_at: string
          delivered_at: string | null
          delivery_status: string | null
          error: string | null
          id: string
          message: string
          phone: string
          status: string
          updated_at: string
          velip_ctid: string | null
          velip_sms_id: string | null
        }
        Insert: {
          balance_after?: number | null
          campaign_id?: string | null
          consultant_id: string
          cost?: number | null
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string | null
          error?: string | null
          id?: string
          message: string
          phone: string
          status?: string
          updated_at?: string
          velip_ctid?: string | null
          velip_sms_id?: string | null
        }
        Update: {
          balance_after?: number | null
          campaign_id?: string | null
          consultant_id?: string
          cost?: number | null
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string | null
          error?: string | null
          id?: string
          message?: string
          phone?: string
          status?: string
          updated_at?: string
          velip_ctid?: string | null
          velip_sms_id?: string | null
        }
        Relationships: []
      }
      voice_template_blocks: {
        Row: {
          audio_url: string | null
          created_at: string
          id: string
          kind: string
          label: string | null
          position: number
          template_id: string
          variable_key: string | null
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          id?: string
          kind: string
          label?: string | null
          position: number
          template_id: string
          variable_key?: string | null
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          position?: number
          template_id?: string
          variable_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_template_blocks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "voice_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_template_renders: {
        Row: {
          created_at: string
          final_audio_url: string
          id: string
          name_normalized: string
          template_id: string
          velip_audio_id: string | null
          velip_uploaded_at: string | null
        }
        Insert: {
          created_at?: string
          final_audio_url: string
          id?: string
          name_normalized: string
          template_id: string
          velip_audio_id?: string | null
          velip_uploaded_at?: string | null
        }
        Update: {
          created_at?: string
          final_audio_url?: string
          id?: string
          name_normalized?: string
          template_id?: string
          velip_audio_id?: string | null
          velip_uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_template_renders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "voice_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_templates: {
        Row: {
          consultant_id: string
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          name: string
          shortcut: string | null
          updated_at: string
          velip_audio_id: string | null
          velip_uploaded_at: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          name: string
          shortcut?: string | null
          updated_at?: string
          velip_audio_id?: string | null
          velip_uploaded_at?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          name?: string
          shortcut?: string | null
          updated_at?: string
          velip_audio_id?: string | null
          velip_uploaded_at?: string | null
        }
        Relationships: []
      }
      voice_webhook_events: {
        Row: {
          campaign_id: string | null
          created_at: string
          event_hash: string
          event_kind: string | null
          id: string
          meta: Json
          provider: string
          target_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          event_hash: string
          event_kind?: string | null
          id?: string
          meta?: Json
          provider?: string
          target_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          event_hash?: string
          event_kind?: string | null
          id?: string
          meta?: Json
          provider?: string
          target_id?: string | null
        }
        Relationships: []
      }
      wallet_manual_topup_requests: {
        Row: {
          amount_cents: number
          approved_at: string | null
          approved_by: string | null
          consultant_id: string
          created_at: string
          created_by: string
          created_by_role: string
          id: string
          note: string | null
          rejection_reason: string | null
          status: string
          updated_at: string
          wallet_transaction_id: string | null
        }
        Insert: {
          amount_cents: number
          approved_at?: string | null
          approved_by?: string | null
          consultant_id: string
          created_at?: string
          created_by: string
          created_by_role: string
          id?: string
          note?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          wallet_transaction_id?: string | null
        }
        Update: {
          amount_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          consultant_id?: string
          created_at?: string
          created_by?: string
          created_by_role?: string
          id?: string
          note?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          wallet_transaction_id?: string | null
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount_cents: number
          balance_after_cents: number | null
          campaign_id: string | null
          consultant_id: string
          created_at: string
          description: string | null
          gross_spend_cents: number | null
          id: string
          metadata: Json | null
          stripe_fee_cents: number
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          type: string
        }
        Insert: {
          amount_cents: number
          balance_after_cents?: number | null
          campaign_id?: string | null
          consultant_id: string
          created_at?: string
          description?: string | null
          gross_spend_cents?: number | null
          id?: string
          metadata?: Json | null
          stripe_fee_cents?: number
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          type: string
        }
        Update: {
          amount_cents?: number
          balance_after_cents?: number | null
          campaign_id?: string | null
          consultant_id?: string
          created_at?: string
          description?: string | null
          gross_spend_cents?: number | null
          id?: string
          metadata?: Json | null
          stripe_fee_cents?: number
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          type?: string
        }
        Relationships: []
      }
      webhook_message_dedup: {
        Row: {
          instance_name: string
          message_id: string
          processed_at: string
        }
        Insert: {
          instance_name: string
          message_id: string
          processed_at?: string
        }
        Update: {
          instance_name?: string
          message_id?: string
          processed_at?: string
        }
        Relationships: []
      }
      webhook_rate_limit: {
        Row: {
          count: number
          phone: string
          window_start: string
        }
        Insert: {
          count?: number
          phone: string
          window_start: string
        }
        Update: {
          count?: number
          phone?: string
          window_start?: string
        }
        Relationships: []
      }
      whapi_send_throttle: {
        Row: {
          day: string | null
          instance_name: string
          last_jid: string | null
          last_slot_at: string | null
          sent_today: number
          updated_at: string
        }
        Insert: {
          day?: string | null
          instance_name: string
          last_jid?: string | null
          last_slot_at?: string | null
          sent_today?: number
          updated_at?: string
        }
        Update: {
          day?: string | null
          instance_name?: string
          last_jid?: string | null
          last_slot_at?: string | null
          sent_today?: number
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_instances: {
        Row: {
          connected_phone: string | null
          consultant_id: string
          created_at: string | null
          fatal_disconnect_at: string | null
          fatal_disconnect_reason: number | null
          fatal_lock_clear_reason: string | null
          fatal_lock_cleared_at: string | null
          fatal_lock_cleared_by: string | null
          fatal_lock_until: string | null
          id: string
          instance_name: string
          last_health_check_at: string | null
          manual_review_required: boolean
          recovery_mode_until: string | null
          status: string
          updated_at: string
          warmup_started_at: string | null
        }
        Insert: {
          connected_phone?: string | null
          consultant_id: string
          created_at?: string | null
          fatal_disconnect_at?: string | null
          fatal_disconnect_reason?: number | null
          fatal_lock_clear_reason?: string | null
          fatal_lock_cleared_at?: string | null
          fatal_lock_cleared_by?: string | null
          fatal_lock_until?: string | null
          id?: string
          instance_name: string
          last_health_check_at?: string | null
          manual_review_required?: boolean
          recovery_mode_until?: string | null
          status?: string
          updated_at?: string
          warmup_started_at?: string | null
        }
        Update: {
          connected_phone?: string | null
          consultant_id?: string
          created_at?: string | null
          fatal_disconnect_at?: string | null
          fatal_disconnect_reason?: number | null
          fatal_lock_clear_reason?: string | null
          fatal_lock_cleared_at?: string | null
          fatal_lock_cleared_by?: string | null
          fatal_lock_until?: string | null
          id?: string
          instance_name?: string
          last_health_check_at?: string | null
          manual_review_required?: boolean
          recovery_mode_until?: string | null
          status?: string
          updated_at?: string
          warmup_started_at?: string | null
        }
        Relationships: []
      }
      whatsapp_message_buffer: {
        Row: {
          consultant_id: string
          created_at: string
          customer_id: string | null
          id: string
          message_id: string | null
          message_text: string | null
          phone: string
          processed_at: string | null
          raw_payload: Json | null
          remote_jid: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          message_id?: string | null
          message_text?: string | null
          phone: string
          processed_at?: string | null
          raw_payload?: Json | null
          remote_jid?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          message_id?: string | null
          message_text?: string | null
          phone?: string
          processed_at?: string | null
          raw_payload?: Json | null
          remote_jid?: string | null
        }
        Relationships: []
      }
      worker_phase_logs: {
        Row: {
          attempt: number | null
          created_at: string
          customer_id: string | null
          duration_ms: number | null
          id: string
          message: string | null
          phase: string
          screenshot_url: string | null
          selector_used: string | null
          status: string
          worker_version: string | null
        }
        Insert: {
          attempt?: number | null
          created_at?: string
          customer_id?: string | null
          duration_ms?: number | null
          id?: string
          message?: string | null
          phase: string
          screenshot_url?: string | null
          selector_used?: string | null
          status?: string
          worker_version?: string | null
        }
        Update: {
          attempt?: number | null
          created_at?: string
          customer_id?: string | null
          duration_ms?: number | null
          id?: string
          message?: string | null
          phase?: string
          screenshot_url?: string | null
          selector_used?: string | null
          status?: string
          worker_version?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      cadence_metrics_daily: {
        Row: {
          channel: Database["public"]["Enums"]["cadence_channel"] | null
          day: string | null
          failed: number | null
          queued: number | null
          responded_leads: number | null
          sent: number | null
          stage: Database["public"]["Enums"]["cadence_stage"] | null
          unique_leads: number | null
        }
        Relationships: []
      }
      cerebro_decisao_sombra: {
        Row: {
          coincide: boolean | null
          consultant_id: string | null
          created_at: string | null
          customer_id: string | null
          estagio: string | null
          id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_decisions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      cerebro_monitor_canario: {
        Row: {
          clientes_total: number | null
          coincidencia_abaixo_limite: boolean | null
          coincidencia_acertos: number | null
          coincidencia_pct: number | null
          coincidencia_turnos: number | null
          consultant_id: string | null
          consultant_name: string | null
          convertidos_7d: number | null
          convertidos_total: number | null
          delegados_total: number | null
          estagio: string | null
          limite_coincidencia_pct: number | null
          pausados_total: number | null
          taxa_conversao_pct: number | null
          turnos_24h: number | null
          turnos_minimos: number | null
        }
        Relationships: []
      }
      cerebro_prontidao_avanco: {
        Row: {
          apto_avancar: boolean | null
          atende_coincidencia: boolean | null
          atende_turnos: boolean | null
          estagio: string | null
          limite_coincidencia_pct: number | null
          motivo: string | null
          taxa_coincidencia_pct: number | null
          total_coincidencias: number | null
          total_turnos: number | null
          turnos_faltantes: number | null
          turnos_minimos: number | null
        }
        Relationships: []
      }
      cerebro_sinal_alerta_coincidencia: {
        Row: {
          alerta_queda_coincidencia: boolean | null
          estagio: string | null
          limite_coincidencia_pct: number | null
          mensagem: string | null
          taxa_coincidencia_pct: number | null
          total_turnos: number | null
          turnos_minimos: number | null
        }
        Relationships: []
      }
      cerebro_taxa_coincidencia_por_estagio: {
        Row: {
          estagio: string | null
          taxa_coincidencia_pct: number | null
          total_coincidencias: number | null
          total_turnos: number | null
        }
        Relationships: []
      }
      cerebro_taxa_coincidencia_por_estagio_consultor: {
        Row: {
          consultant_id: string | null
          estagio: string | null
          taxa_coincidencia_pct: number | null
          total_coincidencias: number | null
          total_turnos: number | null
        }
        Relationships: []
      }
      consultants_public: {
        Row: {
          cadastro_url: string | null
          club_cadastro_url: string | null
          created_at: string | null
          facebook_pixel_id: string | null
          google_analytics_id: string | null
          id: string | null
          igreen_id: string | null
          licenciada_cadastro_url: string | null
          license: string | null
          name: string | null
          phone: string | null
          photo_url: string | null
          referred_by: string | null
        }
        Insert: {
          cadastro_url?: string | null
          club_cadastro_url?: string | null
          created_at?: string | null
          facebook_pixel_id?: string | null
          google_analytics_id?: string | null
          id?: string | null
          igreen_id?: string | null
          licenciada_cadastro_url?: string | null
          license?: string | null
          name?: string | null
          phone?: string | null
          photo_url?: string | null
          referred_by?: string | null
        }
        Update: {
          cadastro_url?: string | null
          club_cadastro_url?: string | null
          created_at?: string | null
          facebook_pixel_id?: string | null
          google_analytics_id?: string | null
          id?: string | null
          igreen_id?: string | null
          licenciada_cadastro_url?: string | null
          license?: string | null
          name?: string | null
          phone?: string | null
          photo_url?: string | null
          referred_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultants_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "consultants_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultants_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultants_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
        ]
      }
      customer_memory_active: {
        Row: {
          active: boolean | null
          category: string | null
          confidence: number | null
          consultant_id: string | null
          created_at: string | null
          customer_id: string | null
          expires_at: string | null
          id: string | null
          key: string | null
          last_confirmed_at: string | null
          metadata: Json | null
          source: string | null
          updated_at: string | null
          value: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          confidence?: number | null
          consultant_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          expires_at?: string | null
          id?: string | null
          key?: string | null
          last_confirmed_at?: string | null
          metadata?: Json | null
          source?: string | null
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          confidence?: number | null
          consultant_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          expires_at?: string | null
          id?: string | null
          key?: string | null
          last_confirmed_at?: string | null
          metadata?: Json | null
          source?: string | null
          updated_at?: string | null
          value?: string | null
        }
        Relationships: []
      }
      igreen_recon_queue_progress: {
        Row: {
          count: number | null
          kind: string | null
          status: string | null
        }
        Relationships: []
      }
      platform_facebook_audience_status: {
        Row: {
          audience_source_count: number | null
          audience_synced_at: string | null
          custom_audience_id: string | null
          id: boolean | null
          retarget_ddd_allowlist: number[] | null
          updated_at: string | null
        }
        Insert: {
          audience_source_count?: number | null
          audience_synced_at?: string | null
          custom_audience_id?: string | null
          id?: boolean | null
          retarget_ddd_allowlist?: number[] | null
          updated_at?: string | null
        }
        Update: {
          audience_source_count?: number | null
          audience_synced_at?: string | null
          custom_audience_id?: string | null
          id?: boolean | null
          retarget_ddd_allowlist?: number[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v_ai_agent_health: {
        Row: {
          avg_latency_ms: number | null
          consultant_id: string | null
          day: string | null
          decisions: number | null
          handoffs: number | null
          intent_detected: string | null
          media_sent: number | null
          model: string | null
          phase: string | null
          selfcheck_blocks: number | null
          tool_called: string | null
        }
        Relationships: []
      }
      v_boletos_carteira: {
        Row: {
          cidade: string | null
          consultant_id: string | null
          conta_unica: boolean | null
          customer_id: string | null
          customer_name: string | null
          dias_atraso: number | null
          fornecedora: string | null
          id: string | null
          idcliente: number | null
          igreen_account_id: string | null
          injecao: boolean | null
          kwh_compensado: number | null
          mes_referencia: string | null
          nome: string | null
          pagamento: string | null
          phone_whatsapp: string | null
          status: string | null
          synced_at: string | null
          tipo_pagamento: string | null
          total: number | null
          uf: string | null
          updated_at: string | null
          url_boleto: string | null
          url_invoice: string | null
          valor_distribuidora: number | null
          valor_fornecedora: number | null
          vencimento: string | null
        }
        Relationships: [
          {
            foreignKeyName: "igreen_customer_boletos_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "cerebro_monitor_canario"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_flow_engine_health"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "igreen_customer_boletos_igreen_account_id_fkey"
            columns: ["igreen_account_id"]
            isOneToOne: false
            referencedRelation: "igreen_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      v_bot_engine_health: {
        Row: {
          channel: string | null
          consultant_id: string | null
          kind: string | null
          mode: string | null
          occurrences: number | null
        }
        Relationships: []
      }
      v_flow_engine_health: {
        Row: {
          consultant_id: string | null
          consultant_name: string | null
          converted_total: number | null
          crm_sync_errors_24h: number | null
          dark_output_error_pct: number | null
          dark_output_errors_24h: number | null
          dark_outputs_24h: number | null
          delegated_total: number | null
          flag: string | null
          last_tick_at: string | null
          paused_total: number | null
          state_rows_total: number | null
          turns_24h: number | null
        }
        Relationships: []
      }
      whatsapp_instances_public: {
        Row: {
          connected_phone: string | null
          consultant_id: string | null
          instance_name: string | null
        }
        Insert: {
          connected_phone?: string | null
          consultant_id?: string | null
          instance_name?: string | null
        }
        Update: {
          connected_phone?: string | null
          consultant_id?: string | null
          instance_name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_recovery_mode: {
        Args: { p_hours?: number; p_instance: string }
        Returns: undefined
      }
      admin_clear_ban: {
        Args: { p_instance: string; p_note?: string }
        Returns: Json
      }
      admin_clear_fatal_lock: {
        Args: { p_instance: string; p_reason: string }
        Returns: undefined
      }
      admin_cron_last_runs: {
        Args: never
        Returns: {
          end_time: string
          jobid: number
          jobname: string
          return_message: string
          start_time: string
          status: string
        }[]
      }
      admin_cron_list: {
        Args: never
        Returns: {
          active: boolean
          command: string
          jobid: number
          jobname: string
          schedule: string
        }[]
      }
      admin_cron_reschedule: {
        Args: { p_job_name: string; p_schedule: string }
        Returns: undefined
      }
      admin_cron_run_now: { Args: { p_job_name: string }; Returns: string }
      admin_cron_toggle: {
        Args: { p_active: boolean; p_job_name: string }
        Returns: undefined
      }
      admin_hard_reset_phone: { Args: { _phone: string }; Returns: Json }
      admin_hard_reset_phone_trace_counts: {
        Args: { _phone: string }
        Returns: Json
      }
      admin_mark_instance_banned: {
        Args: { p_instance: string; p_note?: string }
        Returns: Json
      }
      admin_unpause_global_bot: { Args: never; Returns: number }
      ai_cooldown_check_and_set: {
        Args: { p_key: string; p_reason: string; p_ttl_ms: number }
        Returns: boolean
      }
      assign_flow_variant: { Args: { _consultant_id: string }; Returns: string }
      audio_library_increment_play: {
        Args: { _id: string }
        Returns: undefined
      }
      audit_flow_activate_rules: {
        Args: { _flow_id?: string }
        Returns: {
          dest_step_key: string
          flow_id: string
          flow_name: string
          problem: string
          rule: string
          step_id: string
          step_key: string
        }[]
      }
      bind_customer_campaign: {
        Args: { p_campaign_id: string; p_customer_id: string }
        Returns: {
          campaign_id: string
          outcome: string
        }[]
      }
      bump_ai_cost: {
        Args: {
          p_consultant_id: string
          p_input_tokens: number
          p_model: string
          p_output_tokens: number
          p_phase: string
          p_usd: number
        }
        Returns: undefined
      }
      cadence_stage_group: { Args: { p_stage: string }; Returns: string }
      can_access_remote_support_topic: {
        Args: { _topic: string }
        Returns: boolean
      }
      can_view_consultant: {
        Args: { _consultant: string; _user: string }
        Returns: boolean
      }
      check_consultant_phone_match: {
        Args: { _consultant_id: string }
        Returns: {
          connected_phone: string
          consultant_phone: string
          matched: boolean
          verified_at: string
        }[]
      }
      check_send_quota: { Args: { p_instance: string }; Returns: Json }
      claim_due_cadence: {
        Args: { p_limit?: number }
        Returns: {
          attempts_by_channel: Json
          claim_attempts: number
          claim_token: string | null
          claimed_at: string | null
          consultant_id: string | null
          created_at: string
          customer_id: string
          id: string
          journey_started_at: string | null
          journey_version: number
          last_action_at: string | null
          last_effect_id: string | null
          last_response_at: string | null
          lease_expires_at: string | null
          next_action_at: string | null
          paused_reason: string | null
          paused_until: string | null
          retarget_enabled: boolean
          stage: Database["public"]["Enums"]["cadence_stage"]
          stage_entered_at: string | null
          stage_sequence: number
          temperature: string
          timezone: string
          updated_at: string
          won_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "lead_cadence_state"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_daily_reheat: {
        Args: { p_cycle_date: string; p_limit?: number }
        Returns: {
          claim_attempts: number
          claim_token: string | null
          claimed_at: string | null
          consultant_id: string | null
          created_at: string
          customer_id: string
          cycle_date: string
          id: string
          lease_expires_at: string | null
          next_action_at: string
          planned_actions: Json
          queue: string
          run_id: string | null
          skip_reason: string | null
          status: string
          step: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "daily_reheat_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_followups: {
        Args: { p_limit?: number }
        Returns: {
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          ai_followups_count: number
          ai_last_rescue_at: string | null
          ai_rescue_count: number
          andamento_igreen: string | null
          assigned_consultant_id: string | null
          assigned_human_id: string | null
          assinatura_cliente: string | null
          assinatura_cliente_status: string | null
          assinatura_igreen: string | null
          assinatura_igreen_status: string | null
          attendance_auto_close_at: string | null
          attendance_auto_close_source: string | null
          attendance_ended_at: string | null
          attendance_rating: number | null
          attendance_rating_at: string | null
          attendance_rating_requested_at: string | null
          bill_base64: string | null
          bill_data_confirmation_by: string | null
          bill_data_confirmed_at: string | null
          bill_holder_name: string | null
          bill_message_id: string | null
          bill_owner_relationship: string | null
          bill_requested_at: string | null
          bot_force_enabled: boolean
          bot_paused: boolean
          bot_paused_at: string | null
          bot_paused_reason: string | null
          bot_paused_until: string | null
          bot_processing_until: string | null
          capture_closed_at: string | null
          capture_closed_by: string | null
          capture_mode: string
          capture_started_at: string | null
          cashback: string | null
          cashback_igreen: string | null
          cep: string | null
          chat_cleared_at: string | null
          club_created_at: string | null
          club_dry_run: boolean | null
          club_error: string | null
          club_error_kind: string | null
          club_payload: Json | null
          club_response: Json | null
          club_status: string | null
          club_updated_at: string | null
          commission_rate: number | null
          concessionaria: string | null
          consultant_id: string | null
          conta_pdf_protegida: boolean | null
          contaunica: boolean | null
          contaunica_answered: boolean
          conversation_step: string | null
          conversation_summary: string | null
          conversational_flow_enabled: boolean | null
          converted_at: string | null
          cpf: string | null
          created_at: string
          ctwa_clid: string | null
          custom_step_retries: number
          custom_step_retries_step: string | null
          customer_origin: string
          customer_referred_by_consultant_id: string | null
          customer_referred_by_name: string | null
          customer_referred_by_phone: string | null
          data_ativo: string | null
          data_ativo_igreen: string | null
          data_cadastro: string | null
          data_cadastro_igreen: string | null
          data_injecao_igreen: string | null
          data_nascimento: string | null
          data_nascimento_iso: string | null
          data_validado: string | null
          data_validado_igreen: string | null
          debitos_aberto: boolean | null
          desconto_cliente: number | null
          detour_count: number
          devolutiva: string | null
          distribuidora: string | null
          do_not_contact: boolean
          doc_data_confirmation_by: string | null
          doc_data_confirmed_at: string | null
          doc_holder_name: string | null
          document_back_base64: string | null
          document_back_url: string | null
          document_front_base64: string | null
          document_front_url: string | null
          document_type: string | null
          document_uploaded: boolean | null
          document_verify_at: string | null
          document_verify_status: string | null
          electricity_bill_photo_url: string | null
          electricity_bill_value: number | null
          electricity_boleto_photo_url: string | null
          email: string | null
          error_message: string | null
          facial_confirmed_at: string | null
          facial_link_sent_at: string | null
          finalized_at: string | null
          finalized_by: string | null
          flow_variant: string | null
          fluxo_b_state: Json
          fluxo_b_variant: string
          followup_count: number
          followup_hook: string | null
          fornecedora: string | null
          historico_completo_at: string | null
          id: string
          igreen_account_id: string | null
          igreen_code: string | null
          igreen_link: string | null
          intent_signals: Json | null
          is_converted: boolean
          is_sandbox: boolean
          is_test_lead: boolean
          last_bot_interaction_at: string | null
          last_bot_reply_at: string | null
          last_custom_prompt_at: string | null
          last_enriched_at: string | null
          last_followup_at: string | null
          last_handoff_notified_at: string | null
          last_inbound_media_at: string | null
          last_inbound_media_kind: string | null
          last_inbound_media_message_id: string | null
          last_inbound_media_mime: string | null
          last_inbound_media_url: string | null
          last_new_lead_notified_at: string | null
          last_otp_dispatch_at: string | null
          last_otp_dispatch_error: string | null
          last_partner_notified_at: string | null
          last_portal_dispatch_at: string | null
          last_portal_dispatch_error: string | null
          last_rescue_at: string | null
          last_rule_fire_at: string | null
          last_rule_id: string | null
          last_step_advanced_at: string | null
          lead_source: Json | null
          lead_source_detail: Json | null
          link_assinatura: string | null
          link_facial: string | null
          link_facial_sent_at: string | null
          logindistribuidora: string | null
          manual_override_reactivate: boolean
          manual_review_at: string | null
          manual_review_reason: string | null
          media_consumo: number | null
          media_message_id: string | null
          media_storage: string | null
          meta_retargeting_synced_at: string | null
          name: string | null
          name_ask_sent_at: string | null
          name_mismatch_acknowledged_at: string | null
          name_mismatch_flag: boolean
          name_mismatch_reason: string | null
          name_source: string | null
          needs_manual_review: boolean
          next_followup_at: string | null
          next_rescue_allowed_at: string | null
          nivel_licenciado: string | null
          nome_mae: string | null
          nome_pai: string | null
          nudge_sent_at: string | null
          num_cliente_distribuidora: string | null
          numero_instalacao: string | null
          observacao: string | null
          observacao_igreen: string | null
          ocr_confianca: number | null
          ocr_consumo_original: number | null
          ocr_consumo_rejeitado: boolean | null
          ocr_conta_attempts: number
          ocr_doc_attempts: number
          ocr_done: boolean
          ocr_review_decided_at: string | null
          ocr_review_decided_by: string | null
          ocr_review_pending: string | null
          ocr_review_started_at: string | null
          orgao_expedidor: string | null
          origin_channel: string | null
          origin_consultant_id: string | null
          origin_instance_name: string | null
          origin_recovery: string | null
          otp_code: string | null
          otp_pending_replay: boolean
          otp_received_at: string | null
          otp_status: string | null
          otp_status_checked_at: string | null
          otp_test_phone: string | null
          otp_validated_at: string | null
          pain_point: string | null
          pending_flow_switch: string | null
          pending_inbound_at: string | null
          pending_inbound_message_id: string | null
          pending_snoozed_until: string | null
          phone_contact_confirmed: boolean
          phone_landline: string | null
          phone_whatsapp: string
          pj_jsonb: Json | null
          portal_idconsultor_override: number | null
          portal_last_retry_at: string | null
          portal_retry_count: number
          portal_submitted_at: string | null
          portal2_celular_alt: string | null
          portal2_contract_link: string | null
          portal2_correction_attempts: Json
          portal2_created_at: string | null
          portal2_error: string | null
          portal2_error_kind: string | null
          portal2_extraction_mode: string | null
          portal2_idcliente: number | null
          portal2_idsolcontratovalidacao: number | null
          portal2_ocr_bill_result: Json | null
          portal2_ocr_doc_result: Json | null
          portal2_otp_sent_at: string | null
          portal2_otp_validated_at: string | null
          portal2_status: string | null
          pos_venda_approved_at: string | null
          pos_venda_invalid: boolean
          pos_venda_manual: boolean
          pos_venda_pending_stage: string | null
          pos_venda_reason: string | null
          pos_venda_stage: string | null
          possui_placas: boolean | null
          possui_procurador: boolean | null
          previous_conversation_step: string | null
          procurador_jsonb: Json | null
          qualification_score: number | null
          referral_detected_at: string | null
          referral_keyword_matched: string | null
          referral_partner_id: string | null
          registered_by_igreen_id: string | null
          registered_by_name: string | null
          rescue_attempts: number
          rg: string | null
          sales_phase: string | null
          senha_pdf: string | null
          senhadistribuidora: string | null
          signature_summary: Json | null
          situacao_igreen: string | null
          source_ad_id: string | null
          source_campaign_id: string | null
          source_ctwa_clid: string | null
          source_referral: Json | null
          status: string
          status_financeiro: string | null
          summary_updated_at: string | null
          terms_accepted_at: string | null
          tipo_produto: string
          tracking_protocol: string | null
          transferir_titularidade: boolean | null
          transferir_titularidade_answered: boolean
          updated_at: string
          variant_id: string | null
          welcome_sent_at: string | null
          whatsapp_chat_id: string | null
          whatsapp_chat_id_checked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_recon_job: {
        Args: never
        Returns: {
          attempts: number
          id: string
          kind: string
          params: Json
          target: string
        }[]
      }
      claim_scheduled_messages: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          canceled_at: string | null
          canceled_by: string | null
          consultant_id: string
          created_at: string
          created_by: string | null
          id: string
          instance_name: string
          last_error: string | null
          message_text: string
          processing_started_at: string | null
          remote_jid: string
          scheduled_at: string
          sent_at: string | null
          source_step_id: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "scheduled_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_whapi_send_slot: {
        Args: {
          p_global_ms?: number
          p_instance: string
          p_jid: string
          p_max_wait_ms?: number
          p_same_contact_ms?: number
        }
        Returns: Json
      }
      clamp_to_business_window_brt: { Args: { ts: string }; Returns: string }
      cleanup_bot_test_data: { Args: { _run_id: string }; Returns: Json }
      cleanup_webhook_artifacts: { Args: never; Returns: undefined }
      clear_pending_inbound: {
        Args: { _customer_id: string }
        Returns: undefined
      }
      clear_recovery_mode: { Args: { p_instance: string }; Returns: undefined }
      clone_bot_flow_as: {
        Args: { _consultant_id: string; _variant: string }
        Returns: string
      }
      clone_bot_flow_as_b: { Args: { _consultant_id: string }; Returns: string }
      clone_bot_flow_as_c: { Args: { _consultant_id: string }; Returns: string }
      clone_superadmin_flow_d_steps: {
        Args: { _target_flow_id: string }
        Returns: number
      }
      compute_pos_venda_stage: {
        Args: { _andamento: string; _approved_at: string; _status: string }
        Returns: string
      }
      configure_rodizio_pool: {
        Args: {
          p_campaign_id: string
          p_enabled: boolean
          p_label?: string
          p_partner_ids: string[]
        }
        Returns: {
          enabled: boolean
          members: number
          pool_id: string
        }[]
      }
      confirm_media_send: {
        Args: { p_ok: boolean; p_res_id: string }
        Returns: undefined
      }
      confirm_pending_classification: {
        Args: { _action: string; _customer_id: string }
        Returns: Json
      }
      consume_gemini_token: {
        Args: { p_consultant: string; p_tokens?: number }
        Returns: boolean
      }
      count_captured_leads_by_channel: {
        Args: { p_consultant_id: string }
        Returns: Json
      }
      count_inbound_messages: {
        Args: { p_customer_ids: string[] }
        Returns: {
          cnt: number
          customer_id: string
        }[]
      }
      create_empty_bot_flow_variant: {
        Args: { _consultant_id: string; _name?: string; _variant: string }
        Returns: string
      }
      credit_consultant_wallet:
        | {
            Args: {
              _amount_cents: number
              _consultant_id: string
              _description?: string
              _metadata?: Json
              _stripe_payment_intent_id?: string
              _stripe_session_id?: string
            }
            Returns: number
          }
        | {
            Args: {
              _amount_cents: number
              _consultant_id: string
              _description?: string
              _metadata?: Json
              _stripe_fee_cents?: number
              _stripe_payment_intent_id?: string
              _stripe_session_id?: string
            }
            Returns: number
          }
      debit_consultant_wallet:
        | {
            Args: {
              _amount_cents: number
              _campaign_id?: string
              _consultant_id: string
              _description?: string
              _metadata?: Json
            }
            Returns: number
          }
        | {
            Args: {
              _amount_cents: number
              _campaign_id?: string
              _consultant_id: string
              _description?: string
              _gross_spend_cents?: number
              _metadata?: Json
            }
            Returns: number
          }
      enqueue_pending_inbound: {
        Args: { _customer_id: string; _message_id: string }
        Returns: undefined
      }
      enqueue_single_voice_campaign: {
        Args: {
          p_audio_clip_id: string
          p_audio_url: string
          p_campaign_name: string
          p_config?: Json
          p_consultant_id: string
          p_customer_id: string
          p_logical_key: string
          p_name: string
          p_phone: string
        }
        Returns: {
          campaign_id: string
          existed: boolean
        }[]
      }
      ensure_bot_flow_variant: {
        Args: {
          _consultant_id: string
          _source_variant?: string
          _variant: string
        }
        Returns: string
      }
      ensure_qa_media_slots: {
        Args: { _kinds?: string[]; _qa_id: string }
        Returns: undefined
      }
      ensure_sale_stage_progress: {
        Args: { p_sale_id: string }
        Returns: undefined
      }
      expire_overdue_proposals: { Args: never; Returns: number }
      fb_emit_capi: {
        Args: {
          _consultant_id: string
          _customer_id?: string
          _email?: string
          _event_name: string
          _phone?: string
          _value?: number
        }
        Returns: undefined
      }
      filter_dispatched_phones: {
        Args: { p_consultant_id: string; p_phones: string[] }
        Returns: string[]
      }
      finish_automation_run: {
        Args: {
          p_counters?: Json
          p_error_code?: string
          p_run_id: string
          p_status?: string
        }
        Returns: undefined
      }
      finish_outbound_effect: {
        Args: {
          p_effect_id: string
          p_error_code?: string
          p_from_status?: string[]
          p_provider_message_id?: string
          p_provider_request_id?: string
          p_provider_status?: string
          p_to_status: string
        }
        Returns: boolean
      }
      finish_proactive_touch: {
        Args: {
          p_claim_token: string
          p_outcome?: string
          p_reservation_id: number
        }
        Returns: boolean
      }
      flow_engine_housekeeping: { Args: never; Returns: Json }
      fork_ad_template: { Args: { _origin_id: string }; Returns: string }
      fork_flow_from_public: {
        Args: { _consultant_id: string; _variant: string }
        Returns: string
      }
      fork_message_template: { Args: { _origin_id: string }; Returns: string }
      fork_public_ai_media: { Args: { _media_id: string }; Returns: string }
      funnel_step_rank: { Args: { step: string }; Returns: number }
      gen_partner_short_code: { Args: { p_len?: number }; Returns: string }
      generate_campaign_tracking_protocol: {
        Args: { _channel?: string }
        Returns: string
      }
      generate_partner_protocol: {
        Args: { _initials: string; _partner_id: string }
        Returns: string
      }
      generate_partner_protocol_v2: {
        Args: { _initials: string; _partner_id: string }
        Returns: string
      }
      get_coverage_summary: {
        Args: never
        Returns: {
          cidades: string
          distribuidora: string
          total_clientes: number
          uf: string
        }[]
      }
      get_devtools_blocked: { Args: never; Returns: boolean }
      get_managed_consultant_ids: { Args: { _user: string }; Returns: string[] }
      get_platform_pnl: {
        Args: { _from?: string; _to?: string }
        Returns: {
          charged_to_consultants_cents: number
          gross_meta_spend_cents: number
          gross_topped_up_cents: number
          margin_cents: number
          net_profit_cents: number
          net_received_cents: number
          refunds_cents: number
          stripe_fees_cents: number
        }[]
      }
      get_referral_partner_analytics: {
        Args: never
        Returns: {
          aprovados: number
          conta_recebida: number
          daily_series: Json
          funnel: Json
          keyword_count: number
          keywords: string[]
          last_lead_at: string
          leads_30d: number
          leads_prev_30d: number
          leads_total: number
          partner_id: string
          partner_nome: string
          qr_count: number
          reprovados: number
        }[]
      }
      get_referral_partner_metrics: {
        Args: never
        Returns: {
          lead_count: number
          partner_id: string
          partner_nome: string
        }[]
      }
      get_team_consultant_ids: { Args: { _leader: string }; Returns: string[] }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_ab_metric: {
        Args: {
          p_consultant_id: string
          p_metric: string
          p_step_key: string
          p_template_key: string
          p_variant: string
        }
        Returns: undefined
      }
      is_consultant_online: { Args: { p_consultant: string }; Returns: boolean }
      is_fatal_locked: { Args: { p_instance: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_team_member: {
        Args: { _leader: string; _member: string }
        Returns: boolean
      }
      lead_research_sweep_bump: {
        Args: {
          p_deduped?: number
          p_errors?: number
          p_found?: number
          p_inc_done?: boolean
          p_ingested?: number
          p_sweep_id: string
        }
        Returns: {
          category: string
          consultant_id: string
          created_at: string
          deduped: number
          done_cities: number
          errors: number
          found_phones: number
          id: string
          ingested: number
          status: string
          total_cities: number
          uf: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lead_research_sweeps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lint_bot_flow_consistency: {
        Args: { _consultant_id?: string }
        Returns: {
          category: string
          consultant_id: string
          customer_id: string
          detail: string
          occurrences: number
          severity: string
          step: string
        }[]
      }
      list_stuck_leads: {
        Args: {
          p_consultant: string
          p_limit?: number
          p_offset?: number
          p_step?: string
        }
        Returns: {
          conversation_step: string
          flow_variant: string
          hours_stuck: number
          id: string
          name: string
          phone_whatsapp: string
          total_count: number
          updated_at: string
        }[]
      }
      log_admin_action: {
        Args: {
          _action: string
          _metadata?: Json
          _target_id?: string
          _target_type?: string
        }
        Returns: string
      }
      log_capture_event_if_new: {
        Args: {
          _consultant_id: string
          _customer_id: string
          _field: string
          _source: string
        }
        Returns: undefined
      }
      mark_journey_won: {
        Args: { p_customer_id: string; p_source?: string }
        Returns: boolean
      }
      match_knowledge: {
        Args: {
          p_consultant_id: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          title: string
        }[]
      }
      match_knowledge_all: {
        Args: {
          p_consultant_id: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          conteudo: string
          fonte: string
          similarity: number
          titulo: string
        }[]
      }
      match_winning: {
        Args: {
          p_consultant_id: string
          p_etapa: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          etapa: string
          id: string
          outcome: string
          similarity: number
          snippet: string
        }[]
      }
      next_campaign_protocol_number: {
        Args: { _year?: number }
        Returns: number
      }
      on_journey_inbound: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      pause_sending_now: {
        Args: { p_hours?: number; p_instance: string }
        Returns: string
      }
      publish_flow_as_public: { Args: { _flow_id: string }; Returns: undefined }
      reactivation_outcome_by_step: {
        Args: { p_consultant_id?: string; p_since?: string }
        Returns: {
          abandoned: number
          advanced: number
          conversation_step: string
          responded: number
          total: number
        }[]
      }
      reactivation_outcome_stats: {
        Args: { p_consultant_id?: string; p_since?: string }
        Returns: {
          abandoned: number
          advanced: number
          failed: number
          pending_outcome: number
          responded: number
          sent: number
          total: number
        }[]
      }
      recompute_pos_venda_stages: { Args: never; Returns: number }
      reconcile_stale_outbound_effects: {
        Args: { p_reserved_minutes?: number; p_sending_minutes?: number }
        Returns: {
          released_count: number
          unknown_count: number
        }[]
      }
      reconcile_stale_reactivation_pending: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      reconcile_stuck_bulk_targets: { Args: never; Returns: number }
      reconcile_stuck_cadence_claims: { Args: never; Returns: number }
      reconcile_stuck_daily_reheat_claims: { Args: never; Returns: number }
      reconcile_stuck_scheduled_messages: { Args: never; Returns: number }
      record_risk_signal: {
        Args: {
          p_instance: string
          p_metadata?: Json
          p_severity?: string
          p_signal_type: string
          p_ttl_hours?: number
        }
        Returns: string
      }
      refresh_objection_shortcut: {
        Args: {
          _flow_id: string
          _intent_name: string
          _text_response: string
          _triggers: string[]
        }
        Returns: string
      }
      refund_consultant_wallet: {
        Args: {
          _amount_cents: number
          _consultant_id: string
          _description?: string
          _stripe_payment_intent_id?: string
          _stripe_session_id?: string
        }
        Returns: number
      }
      register_fatal_disconnect: {
        Args: { p_instance: string; p_lock_hours?: number; p_reason: number }
        Returns: undefined
      }
      register_send: { Args: { p_instance: string }; Returns: undefined }
      release_cadence_claim: {
        Args: { p_claim_token: string; p_id: string }
        Returns: boolean
      }
      release_customer_lock: {
        Args: { p_customer: string; p_token: string }
        Returns: boolean
      }
      release_customer_processing_lock: {
        Args: { _customer_id: string }
        Returns: undefined
      }
      remap_bot_flow_step_refs: {
        Args: { _id_map: Json; _value: Json }
        Returns: Json
      }
      remote_support_topic_session: {
        Args: { _topic: string }
        Returns: string
      }
      repair_bot_flow: { Args: { _flow_id: string }; Returns: Json }
      reserve_media_send: {
        Args: {
          p_cons: string
          p_cust: string
          p_kind?: string
          p_media: string
          p_slot_key?: string
        }
        Returns: string
      }
      reserve_outbound_effect: {
        Args: {
          p_action_key?: string
          p_channel: string
          p_claim_id?: string
          p_consultant_id?: string
          p_customer_id?: string
          p_destination_hash?: string
          p_engine_key: string
          p_idempotency_key: string
          p_journey_id?: string
          p_payload_hash?: string
          p_provider?: string
          p_run_id?: string
          p_stage?: string
          p_stage_sequence?: number
          p_template_key?: string
          p_template_version?: string
        }
        Returns: {
          acquired: boolean
          current_status: string
          effect_id: string
        }[]
      }
      reserve_proactive_touch: {
        Args: { p_customer_id: string; p_meta?: Json; p_source_key: string }
        Returns: {
          allowed: boolean
          blocked_by: string
          claim_token: string
          reason: string
          reservation_id: number
        }[]
      }
      reset_all_consultant_conversations: {
        Args: { _consultant_id: string }
        Returns: Json
      }
      reset_consultant_analytics: {
        Args: { _consultant_id: string }
        Returns: Json
      }
      reset_lead_conversation: {
        Args: {
          _consultant_id: string
          _customer_id?: string
          _remote_jid?: string
        }
        Returns: Json
      }
      review_flow_template: {
        Args: { _approve: boolean; _note?: string; _submission_id: string }
        Returns: undefined
      }
      rodizio_assign_lead: {
        Args: { p_campaign_id: string; p_customer_id: string }
        Returns: {
          outcome: string
          partner_id: string
          pool_id: string
          position: number
        }[]
      }
      rodizio_next: {
        Args: { p_campaign_id: string }
        Returns: {
          partner_id: string
          pool_id: string
          position: number
        }[]
      }
      seed_default_camila_flow: {
        Args: { _consultant_id: string }
        Returns: string
      }
      seed_flow_d: { Args: { _consultant_id: string }; Returns: Json }
      seed_full_objection_pack: { Args: { _flow_id: string }; Returns: number }
      seed_igreen_faq_pack: { Args: { _flow_id: string }; Returns: number }
      seed_objection_shortcut: {
        Args: {
          _flow_id: string
          _intent_name: string
          _text_response: string
          _triggers: string[]
        }
        Returns: string
      }
      start_automation_run: {
        Args: {
          p_auth_reason?: string
          p_engine_key: string
          p_mode?: string
          p_trigger_kind?: string
          p_worker_id?: string
        }
        Returns: string
      }
      stuck_leads_grouped_by_step: {
        Args: { p_consultant: string }
        Returns: {
          conversation_step: string
          lead_count: number
        }[]
      }
      submit_flow_template: {
        Args: {
          _description?: string
          _flow_id: string
          _name: string
          _show_phone?: boolean
        }
        Returns: string
      }
      sweep_orphan_media_reservations: {
        Args: { p_max_age_seconds?: number }
        Returns: number
      }
      sync_bot_flow_c_from_a: {
        Args: { _consultant_id: string }
        Returns: string
      }
      sync_flow_from_public: {
        Args: { _consultant_id: string; _variant: string }
        Returns: string
      }
      sync_objection_shortcut_all: {
        Args: {
          _intent_name: string
          _text_response: string
          _triggers: string[]
        }
        Returns: number
      }
      try_acquire_customer_lock: {
        Args: { p_customer: string; p_ttl_ms: number }
        Returns: string
      }
      try_acquire_rate_limit: {
        Args: { p_max_count: number; p_phone: string; p_window_ms: number }
        Returns: boolean
      }
      try_acquire_reconnect_slot: {
        Args: { p_cooldown_ms?: number; p_instance: string }
        Returns: boolean
      }
      try_lock_customer_processing: {
        Args: { _customer_id: string; _seconds?: number }
        Returns: boolean
      }
      try_lock_step_dispatch: {
        Args: { p_customer_id: string; p_step_key: string }
        Returns: boolean
      }
      try_log_media_send: {
        Args: {
          _consultant_id: string
          _customer_id: string
          _kind: string
          _media_id: string
          _slot_key: string
        }
        Returns: boolean
      }
      unaccent: { Args: { "": string }; Returns: string }
      update_sale_status_with_note: {
        Args: {
          p_note?: string
          p_sale_id: string
          p_status: Database["public"]["Enums"]["sale_status"]
        }
        Returns: {
          activated_at: string | null
          amount_cents: number | null
          capture_data: Json
          closed_at: string | null
          consultant_id: string
          created_at: string
          customer_id: string | null
          id: string
          lost_reason: string | null
          notes: string | null
          outcome: string | null
          points_kwh: number
          product_id: string
          source_id: string | null
          source_kind: string | null
          status: Database["public"]["Enums"]["sale_status"]
          submitted_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      use_flow_template: {
        Args: {
          _consultant_id: string
          _name?: string
          _submission_id: string
          _variant: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "user" | "super_admin"
      cadence_channel: "whatsapp" | "voice" | "sms" | "meta_audience" | "system"
      cadence_stage:
        | "NEW"
        | "GREETED"
        | "AI_QUALIFYING"
        | "COLD_1"
        | "COLD_2"
        | "CALL_1"
        | "SMS_1"
        | "COLD_3"
        | "CALL_2"
        | "SMS_2"
        | "COLD_4"
        | "CALL_3"
        | "CLOSE_LOST"
        | "RETARGET_META"
        | "PAUSED"
        | "WON"
        | "RETARGET_ADS_15D"
        | "RECALL_60D"
        | "RECALL_90D"
        | "RECALL_5M"
        | "RECALL_8M"
        | "RECALL_12M"
        | "RECALL_YEARLY"
        | "SMS_TEMA_2"
        | "SMS_TEMA_7"
        | "RECALL_60D_SMS"
        | "RECALL_60D_CALL"
        | "RECALL_90D_SMS"
        | "RECALL_90D_CALL"
        | "RECALL_5M_SMS"
        | "RECALL_5M_CALL"
        | "RECALL_8M_SMS"
        | "RECALL_8M_CALL"
        | "RECALL_12M_SMS"
        | "RECALL_12M_CALL"
        | "RECALL_YEARLY_SMS"
        | "RECALL_YEARLY_CALL"
        | "A_NUDGE"
        | "A_SMS"
        | "A_CALL"
        | "A_CALL_RETRY"
      lead_temperature:
        | "hot"
        | "warm"
        | "cold"
        | "dead"
        | "objection"
        | "rescue"
      product_family:
        | "energia"
        | "placas"
        | "telecom"
        | "seguros"
        | "club"
        | "expansao"
      proposal_event_type:
        | "created"
        | "sent"
        | "viewed"
        | "accepted"
        | "rejected"
        | "countered"
        | "consultant_reply"
        | "expired"
      proposal_status:
        | "draft"
        | "sent"
        | "viewed"
        | "accepted"
        | "rejected"
        | "countered"
        | "expired"
      sale_stage_status: "pendente" | "concluido"
      sale_status: "interesse" | "negociando" | "fechado" | "perdido"
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
      app_role: ["admin", "user", "super_admin"],
      cadence_channel: ["whatsapp", "voice", "sms", "meta_audience", "system"],
      cadence_stage: [
        "NEW",
        "GREETED",
        "AI_QUALIFYING",
        "COLD_1",
        "COLD_2",
        "CALL_1",
        "SMS_1",
        "COLD_3",
        "CALL_2",
        "SMS_2",
        "COLD_4",
        "CALL_3",
        "CLOSE_LOST",
        "RETARGET_META",
        "PAUSED",
        "WON",
        "RETARGET_ADS_15D",
        "RECALL_60D",
        "RECALL_90D",
        "RECALL_5M",
        "RECALL_8M",
        "RECALL_12M",
        "RECALL_YEARLY",
        "SMS_TEMA_2",
        "SMS_TEMA_7",
        "RECALL_60D_SMS",
        "RECALL_60D_CALL",
        "RECALL_90D_SMS",
        "RECALL_90D_CALL",
        "RECALL_5M_SMS",
        "RECALL_5M_CALL",
        "RECALL_8M_SMS",
        "RECALL_8M_CALL",
        "RECALL_12M_SMS",
        "RECALL_12M_CALL",
        "RECALL_YEARLY_SMS",
        "RECALL_YEARLY_CALL",
        "A_NUDGE",
        "A_SMS",
        "A_CALL",
        "A_CALL_RETRY",
      ],
      lead_temperature: ["hot", "warm", "cold", "dead", "objection", "rescue"],
      product_family: [
        "energia",
        "placas",
        "telecom",
        "seguros",
        "club",
        "expansao",
      ],
      proposal_event_type: [
        "created",
        "sent",
        "viewed",
        "accepted",
        "rejected",
        "countered",
        "consultant_reply",
        "expired",
      ],
      proposal_status: [
        "draft",
        "sent",
        "viewed",
        "accepted",
        "rejected",
        "countered",
        "expired",
      ],
      sale_stage_status: ["pendente", "concluido"],
      sale_status: ["interesse", "negociando", "fechado", "perdido"],
    },
  },
} as const
