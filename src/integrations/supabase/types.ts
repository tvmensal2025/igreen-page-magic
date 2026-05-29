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
        }
        Insert: {
          age_max?: number
          age_min?: number
          avg_cpl_cents?: number | null
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
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
        }
        Update: {
          age_max?: number
          age_min?: number
          avg_cpl_cents?: number | null
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
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
          content: string
          created_at: string
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
          content: string
          created_at?: string
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
          content?: string
          created_at?: string
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
      app_settings: {
        Row: {
          bot_engine_production_mode: boolean
          bot_global_enabled: boolean
          id: string
          minio_alert_threshold_pct: number
          resolver_strict_mode: boolean
          super_admin_instance_name: string | null
          super_admin_phone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bot_engine_production_mode?: boolean
          bot_global_enabled?: boolean
          id?: string
          minio_alert_threshold_pct?: number
          resolver_strict_mode?: boolean
          super_admin_instance_name?: string | null
          super_admin_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bot_engine_production_mode?: boolean
          bot_global_enabled?: boolean
          id?: string
          minio_alert_threshold_pct?: number
          resolver_strict_mode?: boolean
          super_admin_instance_name?: string | null
          super_admin_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      bot_flow_qa: {
        Row: {
          created_at: string
          flow_id: string
          id: string
          intent_name: string
          is_closing: boolean
          is_opening: boolean
          position: number
          text_response: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          flow_id: string
          id?: string
          intent_name?: string
          is_closing?: boolean
          is_opening?: boolean
          position?: number
          text_response?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          flow_id?: string
          id?: string
          intent_name?: string
          is_closing?: boolean
          is_opening?: boolean
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
        ]
      }
      bot_flows: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          strict_mode: boolean
          updated_at: string
          variant: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          strict_mode?: boolean
          updated_at?: string
          variant?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          strict_mode?: boolean
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
      consultant_ad_settings: {
        Row: {
          age_max: number
          age_min: number
          cities: Json
          consultant_id: string
          created_at: string
          display_name: string | null
          distribuidora_default: string | null
          updated_at: string
          whatsapp_destination_number: string | null
        }
        Insert: {
          age_max?: number
          age_min?: number
          cities?: Json
          consultant_id: string
          created_at?: string
          display_name?: string | null
          distribuidora_default?: string | null
          updated_at?: string
          whatsapp_destination_number?: string | null
        }
        Update: {
          age_max?: number
          age_min?: number
          cities?: Json
          consultant_id?: string
          created_at?: string
          display_name?: string | null
          distribuidora_default?: string | null
          updated_at?: string
          whatsapp_destination_number?: string | null
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
          ai_profile: string
          ai_provider_pref: string
          approved: boolean | null
          bot_engine_mode: string
          cadastro_url: string
          conversational_flow_enabled: boolean
          created_at: string | null
          facebook_label_id: string | null
          facebook_pixel_id: string | null
          flow_engine_v3: string
          flow_reliability_v2: string
          flow_step_media_order: Json
          google_analytics_id: string | null
          id: string
          igreen_id: string | null
          igreen_portal_email: string | null
          igreen_portal_password: string | null
          licenciada_cadastro_url: string | null
          license: string
          name: string
          notification_phone: string | null
          phone: string
          photo_url: string | null
          portal_kind: string
          referred_by: string | null
          use_engine_v3: boolean
        }
        Insert: {
          ab_test_counter?: number
          ab_test_enabled?: boolean
          active_variants?: string[]
          ai_persona?: string | null
          ai_profile?: string
          ai_provider_pref?: string
          approved?: boolean | null
          bot_engine_mode?: string
          cadastro_url: string
          conversational_flow_enabled?: boolean
          created_at?: string | null
          facebook_label_id?: string | null
          facebook_pixel_id?: string | null
          flow_engine_v3?: string
          flow_reliability_v2?: string
          flow_step_media_order?: Json
          google_analytics_id?: string | null
          id: string
          igreen_id?: string | null
          igreen_portal_email?: string | null
          igreen_portal_password?: string | null
          licenciada_cadastro_url?: string | null
          license: string
          name: string
          notification_phone?: string | null
          phone: string
          photo_url?: string | null
          portal_kind?: string
          referred_by?: string | null
          use_engine_v3?: boolean
        }
        Update: {
          ab_test_counter?: number
          ab_test_enabled?: boolean
          active_variants?: string[]
          ai_persona?: string | null
          ai_profile?: string
          ai_provider_pref?: string
          approved?: boolean | null
          bot_engine_mode?: string
          cadastro_url?: string
          conversational_flow_enabled?: boolean
          created_at?: string | null
          facebook_label_id?: string | null
          facebook_pixel_id?: string | null
          flow_engine_v3?: string
          flow_reliability_v2?: string
          flow_step_media_order?: Json
          google_analytics_id?: string | null
          id?: string
          igreen_id?: string | null
          igreen_portal_email?: string | null
          igreen_portal_password?: string | null
          licenciada_cadastro_url?: string | null
          license?: string
          name?: string
          notification_phone?: string | null
          phone?: string
          photo_url?: string | null
          portal_kind?: string
          referred_by?: string | null
          use_engine_v3?: boolean
        }
        Relationships: [
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
      conversations: {
        Row: {
          conversation_step: string | null
          created_at: string
          customer_id: string
          id: string
          media_id: string | null
          message_direction: string
          message_text: string | null
          message_text_hash: string | null
          message_type: string | null
          slot_key: string | null
        }
        Insert: {
          conversation_step?: string | null
          created_at?: string
          customer_id: string
          id?: string
          media_id?: string | null
          message_direction: string
          message_text?: string | null
          message_text_hash?: string | null
          message_type?: string | null
          slot_key?: string | null
        }
        Update: {
          conversation_step?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          media_id?: string | null
          message_direction?: string
          message_text?: string | null
          message_text_hash?: string | null
          message_type?: string | null
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
          assinatura_igreen: string | null
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
          capture_mode: string
          capture_started_at: string | null
          cashback: string | null
          cep: string | null
          chat_cleared_at: string | null
          consultant_id: string | null
          conta_pdf_protegida: boolean | null
          conversation_step: string | null
          conversation_summary: string | null
          conversational_flow_enabled: boolean | null
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
          data_cadastro: string | null
          data_nascimento: string | null
          data_validado: string | null
          debitos_aberto: boolean | null
          desconto_cliente: number | null
          detour_count: number
          devolutiva: string | null
          distribuidora: string | null
          do_not_contact: boolean
          doc_data_confirmation_by: string | null
          doc_data_confirmed_at: string | null
          doc_holder_name: string | null
          document_back_url: string | null
          document_front_base64: string | null
          document_front_url: string | null
          document_type: string | null
          document_uploaded: boolean | null
          electricity_bill_photo_url: string | null
          electricity_bill_value: number | null
          email: string | null
          error_message: string | null
          facial_confirmed_at: string | null
          facial_link_sent_at: string | null
          finalized_at: string | null
          finalized_by: string | null
          flow_variant: string | null
          followup_count: number
          id: string
          igreen_code: string | null
          igreen_link: string | null
          intent_signals: Json | null
          is_sandbox: boolean
          is_test_lead: boolean
          last_bot_interaction_at: string | null
          last_bot_reply_at: string | null
          last_custom_prompt_at: string | null
          last_followup_at: string | null
          last_handoff_notified_at: string | null
          last_inbound_media_at: string | null
          last_inbound_media_kind: string | null
          last_inbound_media_message_id: string | null
          last_inbound_media_mime: string | null
          last_inbound_media_url: string | null
          last_new_lead_notified_at: string | null
          last_rescue_at: string | null
          last_rule_fire_at: string | null
          last_rule_id: string | null
          last_step_advanced_at: string | null
          lead_source: Json | null
          lead_source_detail: Json | null
          link_assinatura: string | null
          link_facial: string | null
          media_consumo: number | null
          media_message_id: string | null
          media_storage: string | null
          name: string | null
          name_ask_sent_at: string | null
          name_mismatch_acknowledged_at: string | null
          name_mismatch_flag: boolean
          name_mismatch_reason: string | null
          name_source: string | null
          next_followup_at: string | null
          next_rescue_allowed_at: string | null
          nivel_licenciado: string | null
          nome_mae: string | null
          nome_pai: string | null
          numero_instalacao: string | null
          observacao: string | null
          ocr_confianca: number | null
          ocr_conta_attempts: number
          ocr_doc_attempts: number
          ocr_done: boolean
          ocr_review_decided_at: string | null
          ocr_review_decided_by: string | null
          ocr_review_pending: string | null
          ocr_review_started_at: string | null
          otp_code: string | null
          otp_received_at: string | null
          otp_test_phone: string | null
          otp_validated_at: string | null
          pain_point: string | null
          pending_flow_switch: string | null
          pending_inbound_at: string | null
          pending_inbound_message_id: string | null
          phone_contact_confirmed: boolean
          phone_landline: string | null
          phone_whatsapp: string
          portal_last_retry_at: string | null
          portal_retry_count: number
          portal_submitted_at: string | null
          portal2_contract_link: string | null
          portal2_created_at: string | null
          portal2_error: string | null
          portal2_idcliente: number | null
          portal2_idsolcontratovalidacao: number | null
          portal2_otp_sent_at: string | null
          portal2_otp_validated_at: string | null
          portal2_status: string | null
          pos_venda_manual: boolean
          pos_venda_reason: string | null
          pos_venda_stage: string | null
          possui_procurador: boolean | null
          previous_conversation_step: string | null
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
          source_ad_id: string | null
          source_campaign_id: string | null
          source_ctwa_clid: string | null
          source_referral: Json | null
          status: string
          status_financeiro: string | null
          summary_updated_at: string | null
          tipo_produto: string
          updated_at: string
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
          assinatura_igreen?: string | null
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
          capture_mode?: string
          capture_started_at?: string | null
          cashback?: string | null
          cep?: string | null
          chat_cleared_at?: string | null
          consultant_id?: string | null
          conta_pdf_protegida?: boolean | null
          conversation_step?: string | null
          conversation_summary?: string | null
          conversational_flow_enabled?: boolean | null
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
          data_cadastro?: string | null
          data_nascimento?: string | null
          data_validado?: string | null
          debitos_aberto?: boolean | null
          desconto_cliente?: number | null
          detour_count?: number
          devolutiva?: string | null
          distribuidora?: string | null
          do_not_contact?: boolean
          doc_data_confirmation_by?: string | null
          doc_data_confirmed_at?: string | null
          doc_holder_name?: string | null
          document_back_url?: string | null
          document_front_base64?: string | null
          document_front_url?: string | null
          document_type?: string | null
          document_uploaded?: boolean | null
          electricity_bill_photo_url?: string | null
          electricity_bill_value?: number | null
          email?: string | null
          error_message?: string | null
          facial_confirmed_at?: string | null
          facial_link_sent_at?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          flow_variant?: string | null
          followup_count?: number
          id?: string
          igreen_code?: string | null
          igreen_link?: string | null
          intent_signals?: Json | null
          is_sandbox?: boolean
          is_test_lead?: boolean
          last_bot_interaction_at?: string | null
          last_bot_reply_at?: string | null
          last_custom_prompt_at?: string | null
          last_followup_at?: string | null
          last_handoff_notified_at?: string | null
          last_inbound_media_at?: string | null
          last_inbound_media_kind?: string | null
          last_inbound_media_message_id?: string | null
          last_inbound_media_mime?: string | null
          last_inbound_media_url?: string | null
          last_new_lead_notified_at?: string | null
          last_rescue_at?: string | null
          last_rule_fire_at?: string | null
          last_rule_id?: string | null
          last_step_advanced_at?: string | null
          lead_source?: Json | null
          lead_source_detail?: Json | null
          link_assinatura?: string | null
          link_facial?: string | null
          media_consumo?: number | null
          media_message_id?: string | null
          media_storage?: string | null
          name?: string | null
          name_ask_sent_at?: string | null
          name_mismatch_acknowledged_at?: string | null
          name_mismatch_flag?: boolean
          name_mismatch_reason?: string | null
          name_source?: string | null
          next_followup_at?: string | null
          next_rescue_allowed_at?: string | null
          nivel_licenciado?: string | null
          nome_mae?: string | null
          nome_pai?: string | null
          numero_instalacao?: string | null
          observacao?: string | null
          ocr_confianca?: number | null
          ocr_conta_attempts?: number
          ocr_doc_attempts?: number
          ocr_done?: boolean
          ocr_review_decided_at?: string | null
          ocr_review_decided_by?: string | null
          ocr_review_pending?: string | null
          ocr_review_started_at?: string | null
          otp_code?: string | null
          otp_received_at?: string | null
          otp_test_phone?: string | null
          otp_validated_at?: string | null
          pain_point?: string | null
          pending_flow_switch?: string | null
          pending_inbound_at?: string | null
          pending_inbound_message_id?: string | null
          phone_contact_confirmed?: boolean
          phone_landline?: string | null
          phone_whatsapp: string
          portal_last_retry_at?: string | null
          portal_retry_count?: number
          portal_submitted_at?: string | null
          portal2_contract_link?: string | null
          portal2_created_at?: string | null
          portal2_error?: string | null
          portal2_idcliente?: number | null
          portal2_idsolcontratovalidacao?: number | null
          portal2_otp_sent_at?: string | null
          portal2_otp_validated_at?: string | null
          portal2_status?: string | null
          pos_venda_manual?: boolean
          pos_venda_reason?: string | null
          pos_venda_stage?: string | null
          possui_procurador?: boolean | null
          previous_conversation_step?: string | null
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
          source_ad_id?: string | null
          source_campaign_id?: string | null
          source_ctwa_clid?: string | null
          source_referral?: Json | null
          status?: string
          status_financeiro?: string | null
          summary_updated_at?: string | null
          tipo_produto?: string
          updated_at?: string
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
          assinatura_igreen?: string | null
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
          capture_mode?: string
          capture_started_at?: string | null
          cashback?: string | null
          cep?: string | null
          chat_cleared_at?: string | null
          consultant_id?: string | null
          conta_pdf_protegida?: boolean | null
          conversation_step?: string | null
          conversation_summary?: string | null
          conversational_flow_enabled?: boolean | null
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
          data_cadastro?: string | null
          data_nascimento?: string | null
          data_validado?: string | null
          debitos_aberto?: boolean | null
          desconto_cliente?: number | null
          detour_count?: number
          devolutiva?: string | null
          distribuidora?: string | null
          do_not_contact?: boolean
          doc_data_confirmation_by?: string | null
          doc_data_confirmed_at?: string | null
          doc_holder_name?: string | null
          document_back_url?: string | null
          document_front_base64?: string | null
          document_front_url?: string | null
          document_type?: string | null
          document_uploaded?: boolean | null
          electricity_bill_photo_url?: string | null
          electricity_bill_value?: number | null
          email?: string | null
          error_message?: string | null
          facial_confirmed_at?: string | null
          facial_link_sent_at?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          flow_variant?: string | null
          followup_count?: number
          id?: string
          igreen_code?: string | null
          igreen_link?: string | null
          intent_signals?: Json | null
          is_sandbox?: boolean
          is_test_lead?: boolean
          last_bot_interaction_at?: string | null
          last_bot_reply_at?: string | null
          last_custom_prompt_at?: string | null
          last_followup_at?: string | null
          last_handoff_notified_at?: string | null
          last_inbound_media_at?: string | null
          last_inbound_media_kind?: string | null
          last_inbound_media_message_id?: string | null
          last_inbound_media_mime?: string | null
          last_inbound_media_url?: string | null
          last_new_lead_notified_at?: string | null
          last_rescue_at?: string | null
          last_rule_fire_at?: string | null
          last_rule_id?: string | null
          last_step_advanced_at?: string | null
          lead_source?: Json | null
          lead_source_detail?: Json | null
          link_assinatura?: string | null
          link_facial?: string | null
          media_consumo?: number | null
          media_message_id?: string | null
          media_storage?: string | null
          name?: string | null
          name_ask_sent_at?: string | null
          name_mismatch_acknowledged_at?: string | null
          name_mismatch_flag?: boolean
          name_mismatch_reason?: string | null
          name_source?: string | null
          next_followup_at?: string | null
          next_rescue_allowed_at?: string | null
          nivel_licenciado?: string | null
          nome_mae?: string | null
          nome_pai?: string | null
          numero_instalacao?: string | null
          observacao?: string | null
          ocr_confianca?: number | null
          ocr_conta_attempts?: number
          ocr_doc_attempts?: number
          ocr_done?: boolean
          ocr_review_decided_at?: string | null
          ocr_review_decided_by?: string | null
          ocr_review_pending?: string | null
          ocr_review_started_at?: string | null
          otp_code?: string | null
          otp_received_at?: string | null
          otp_test_phone?: string | null
          otp_validated_at?: string | null
          pain_point?: string | null
          pending_flow_switch?: string | null
          pending_inbound_at?: string | null
          pending_inbound_message_id?: string | null
          phone_contact_confirmed?: boolean
          phone_landline?: string | null
          phone_whatsapp?: string
          portal_last_retry_at?: string | null
          portal_retry_count?: number
          portal_submitted_at?: string | null
          portal2_contract_link?: string | null
          portal2_created_at?: string | null
          portal2_error?: string | null
          portal2_idcliente?: number | null
          portal2_idsolcontratovalidacao?: number | null
          portal2_otp_sent_at?: string | null
          portal2_otp_validated_at?: string | null
          portal2_status?: string | null
          pos_venda_manual?: boolean
          pos_venda_reason?: string | null
          pos_venda_stage?: string | null
          possui_procurador?: boolean | null
          previous_conversation_step?: string | null
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
          source_ad_id?: string | null
          source_campaign_id?: string | null
          source_ctwa_clid?: string | null
          source_referral?: Json | null
          status?: string
          status_financeiro?: string | null
          summary_updated_at?: string | null
          tipo_produto?: string
          updated_at?: string
        }
        Relationships: [
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
          cities: Json
          consultant_id: string
          created_at: string
          creative_pack_id: string | null
          daily_budget_cents: number
          distribuidora: string | null
          duration_days: number | null
          ended_at: string | null
          fb_ad_ids: Json
          fb_adset_ids: Json
          fb_campaign_id: string | null
          id: string
          initial_message: string | null
          leads_count: number
          migrated_to_abo_at: string | null
          name: string
          optimization_strategy: string
          parent_campaign_id: string | null
          pixel_event_optimized: string | null
          rejection_reason: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          age_max?: number
          age_min?: number
          cities?: Json
          consultant_id: string
          created_at?: string
          creative_pack_id?: string | null
          daily_budget_cents: number
          distribuidora?: string | null
          duration_days?: number | null
          ended_at?: string | null
          fb_ad_ids?: Json
          fb_adset_ids?: Json
          fb_campaign_id?: string | null
          id?: string
          initial_message?: string | null
          leads_count?: number
          migrated_to_abo_at?: string | null
          name: string
          optimization_strategy?: string
          parent_campaign_id?: string | null
          pixel_event_optimized?: string | null
          rejection_reason?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          age_max?: number
          age_min?: number
          cities?: Json
          consultant_id?: string
          created_at?: string
          creative_pack_id?: string | null
          daily_budget_cents?: number
          distribuidora?: string | null
          duration_days?: number | null
          ended_at?: string | null
          fb_ad_ids?: Json
          fb_adset_ids?: Json
          fb_campaign_id?: string | null
          id?: string
          initial_message?: string | null
          leads_count?: number
          migrated_to_abo_at?: string | null
          name?: string
          optimization_strategy?: string
          parent_campaign_id?: string | null
          pixel_event_optimized?: string | null
          rejection_reason?: string | null
          started_at?: string | null
          status?: string
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
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          consultant_id: string
          content: string
          created_at: string | null
          id: string
          image_url: string | null
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
      network_members: {
        Row: {
          bonificavel: number | null
          cidade: string | null
          clientes_ativos: number | null
          consultant_id: string
          data_ativo: string | null
          data_nascimento: string | null
          diretos_ativos: number | null
          diretos_inicio_rapido: number | null
          diretos_mes: number | null
          gi: number | null
          gi_mes: number | null
          gi_total: number | null
          gp: number | null
          gp_mes: number | null
          gp_total: number | null
          graduacao: string | null
          graduacao_expansao: string | null
          green_points: number | null
          green_points_mes: number | null
          id: string
          igreen_id: number
          inicio_rapido: string | null
          name: string
          nivel: number | null
          phone: string | null
          pro: string | null
          qtde_diretos: number | null
          sponsor_id: number | null
          total_pontos: number | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          bonificavel?: number | null
          cidade?: string | null
          clientes_ativos?: number | null
          consultant_id: string
          data_ativo?: string | null
          data_nascimento?: string | null
          diretos_ativos?: number | null
          diretos_inicio_rapido?: number | null
          diretos_mes?: number | null
          gi?: number | null
          gi_mes?: number | null
          gi_total?: number | null
          gp?: number | null
          gp_mes?: number | null
          gp_total?: number | null
          graduacao?: string | null
          graduacao_expansao?: string | null
          green_points?: number | null
          green_points_mes?: number | null
          id?: string
          igreen_id: number
          inicio_rapido?: string | null
          name: string
          nivel?: number | null
          phone?: string | null
          pro?: string | null
          qtde_diretos?: number | null
          sponsor_id?: number | null
          total_pontos?: number | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          bonificavel?: number | null
          cidade?: string | null
          clientes_ativos?: number | null
          consultant_id?: string
          data_ativo?: string | null
          data_nascimento?: string | null
          diretos_ativos?: number | null
          diretos_inicio_rapido?: number | null
          diretos_mes?: number | null
          gi?: number | null
          gi_mes?: number | null
          gi_total?: number | null
          gp?: number | null
          gp_mes?: number | null
          gp_total?: number | null
          graduacao?: string | null
          graduacao_expansao?: string | null
          green_points?: number | null
          green_points_mes?: number | null
          id?: string
          igreen_id?: number
          inicio_rapido?: string | null
          name?: string
          nivel?: number | null
          phone?: string | null
          pro?: string | null
          qtde_diretos?: number | null
          sponsor_id?: number | null
          total_pontos?: number | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      outbound_message_log: {
        Row: {
          consultant_id: string
          created_at: string
          customer_id: string
          evolution_message_id: string | null
          idempotency_key: string
          payload_hash: string
          result_status: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          customer_id: string
          evolution_message_id?: string | null
          idempotency_key: string
          payload_hash: string
          result_status?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          customer_id?: string
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
      referral_partners: {
        Row: {
          cli: string
          consultant_id: string
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          nome: string
          qr_phrase: string | null
          updated_at: string
        }
        Insert: {
          cli: string
          consultant_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          nome: string
          qr_phrase?: string | null
          updated_at?: string
        }
        Update: {
          cli?: string
          consultant_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          nome?: string
          qr_phrase?: string | null
          updated_at?: string
        }
        Relationships: [
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
      scheduled_messages: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          instance_name: string
          message_text: string
          remote_jid: string
          scheduled_at: string
          sent_at: string | null
          source_step_id: string | null
          status: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          instance_name: string
          message_text: string
          remote_jid: string
          scheduled_at: string
          sent_at?: string | null
          source_step_id?: string | null
          status?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          instance_name?: string
          message_text?: string
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
        }
        Relationships: [
          {
            foreignKeyName: "stage_auto_messages_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "kanban_stages"
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
        }
        Insert: {
          created_at?: string
          final_audio_url: string
          id?: string
          name_normalized: string
          template_id: string
        }
        Update: {
          created_at?: string
          final_audio_url?: string
          id?: string
          name_normalized?: string
          template_id?: string
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
          name: string
          shortcut: string | null
          updated_at: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          shortcut?: string | null
          updated_at?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          shortcut?: string | null
          updated_at?: string
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
      whatsapp_instances: {
        Row: {
          connected_phone: string | null
          consultant_id: string
          created_at: string | null
          id: string
          instance_name: string
          last_health_check_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          connected_phone?: string | null
          consultant_id: string
          created_at?: string | null
          id?: string
          instance_name: string
          last_health_check_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          connected_phone?: string | null
          consultant_id?: string
          created_at?: string | null
          id?: string
          instance_name?: string
          last_health_check_at?: string | null
          status?: string
          updated_at?: string
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
      consultants_public: {
        Row: {
          cadastro_url: string | null
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
          instance_name: string | null
        }
        Insert: {
          connected_phone?: string | null
          instance_name?: string | null
        }
        Update: {
          connected_phone?: string | null
          instance_name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_unpause_global_bot: { Args: never; Returns: number }
      ai_cooldown_check_and_set: {
        Args: { p_key: string; p_reason: string; p_ttl_ms: number }
        Returns: boolean
      }
      assign_flow_variant: { Args: { _consultant_id: string }; Returns: string }
      can_view_consultant: {
        Args: { _consultant: string; _user: string }
        Returns: boolean
      }
      cleanup_bot_test_data: { Args: { _run_id: string }; Returns: Json }
      cleanup_webhook_artifacts: { Args: never; Returns: undefined }
      clear_pending_inbound: {
        Args: { _customer_id: string }
        Returns: undefined
      }
      clone_bot_flow_as: {
        Args: { _consultant_id: string; _variant: string }
        Returns: string
      }
      clone_bot_flow_as_b: { Args: { _consultant_id: string }; Returns: string }
      clone_bot_flow_as_c: { Args: { _consultant_id: string }; Returns: string }
      compute_pos_venda_stage: {
        Args: { _andamento: string; _status: string; _submitted_at: string }
        Returns: string
      }
      confirm_media_send: {
        Args: { p_ok: boolean; p_res_id: string }
        Returns: undefined
      }
      consume_gemini_token: {
        Args: { p_consultant: string; p_tokens?: number }
        Returns: boolean
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
      flow_engine_housekeeping: { Args: never; Returns: Json }
      fork_ad_template: { Args: { _origin_id: string }; Returns: string }
      fork_message_template: { Args: { _origin_id: string }; Returns: string }
      fork_public_ai_media: { Args: { _media_id: string }; Returns: string }
      get_coverage_summary: {
        Args: never
        Returns: {
          cidades: string
          distribuidora: string
          total_clientes: number
          uf: string
        }[]
      }
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
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_team_member: {
        Args: { _leader: string; _member: string }
        Returns: boolean
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
      recompute_pos_venda_stages: { Args: never; Returns: number }
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
      release_customer_lock: {
        Args: { p_customer: string; p_token: string }
        Returns: boolean
      }
      release_customer_processing_lock: {
        Args: { _customer_id: string }
        Returns: undefined
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
      seed_default_camila_flow: {
        Args: { _consultant_id: string }
        Returns: string
      }
      seed_flow_d: { Args: { _consultant_id: string }; Returns: Json }
      seed_objection_shortcut: {
        Args: {
          _flow_id: string
          _intent_name: string
          _text_response: string
          _triggers: string[]
        }
        Returns: string
      }
      sweep_orphan_media_reservations: {
        Args: { p_max_age_seconds?: number }
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
      try_lock_customer_processing: {
        Args: { _customer_id: string; _seconds?: number }
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
    }
    Enums: {
      app_role: "admin" | "user" | "super_admin"
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
    },
  },
} as const
