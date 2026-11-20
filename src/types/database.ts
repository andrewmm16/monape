// ARCHIVO GENERADO por scripts/gen-db-types.ts a partir de supabase/migrations.
// No editar manualmente: ejecutar `npm run db:types`.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13"
  }
  public: {
    Tables: {
      ai_evaluation_jobs: {
        Row: {
          application_id: string
          attempts: number
          available_at: string
          claim_token: string | null
          claimed_at: string | null
          criteria_version: number | null
          error_code: string | null
          evaluation_id: string | null
          finished_at: string | null
          id: string
          input_sha256: string | null
          origin: Database["public"]["Enums"]["ai_job_origin"]
          requested_at: string
          requested_by: string | null
          status: Database["public"]["Enums"]["ai_job_status"]
          updated_at: string
        }
        Insert: {
          application_id: string
          attempts?: number
          available_at?: string
          claim_token?: string | null
          claimed_at?: string | null
          criteria_version?: number | null
          error_code?: string | null
          evaluation_id?: string | null
          finished_at?: string | null
          id?: string
          input_sha256?: string | null
          origin: Database["public"]["Enums"]["ai_job_origin"]
          requested_at?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["ai_job_status"]
          updated_at?: string
        }
        Update: {
          application_id?: string
          attempts?: number
          available_at?: string
          claim_token?: string | null
          claimed_at?: string | null
          criteria_version?: number | null
          error_code?: string | null
          evaluation_id?: string | null
          finished_at?: string | null
          id?: string
          input_sha256?: string | null
          origin?: Database["public"]["Enums"]["ai_job_origin"]
          requested_at?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["ai_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_evaluation_jobs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_evaluation_jobs_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "candidate_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_evaluation_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_quality_checks: {
        Row: {
          accuracy_ai: number | null
          accuracy_engine: number | null
          accuracy_relay: number | null
          accuracy_relay_lenient: number | null
          ai_over_accredited: number
          cells: number
          checked_at: string
          cv_count: number
          failures: number
          id: string
          model: string
          order_inversions: number
          prompt_version: string
          reasons: string[]
          seconds_per_cv: number | null
          status: string
        }
        Insert: {
          accuracy_ai?: number | null
          accuracy_engine?: number | null
          accuracy_relay?: number | null
          accuracy_relay_lenient?: number | null
          ai_over_accredited: number
          cells: number
          checked_at?: string
          cv_count: number
          failures: number
          id?: string
          model: string
          order_inversions?: number
          prompt_version: string
          reasons?: string[]
          seconds_per_cv?: number | null
          status: string
        }
        Update: {
          accuracy_ai?: number | null
          accuracy_engine?: number | null
          accuracy_relay?: number | null
          accuracy_relay_lenient?: number | null
          ai_over_accredited?: number
          cells?: number
          checked_at?: string
          cv_count?: number
          failures?: number
          id?: string
          model?: string
          order_inversions?: number
          prompt_version?: string
          reasons?: string[]
          seconds_per_cv?: number | null
          status?: string
        }
        Relationships: []
      }
      ai_worker_status: {
        Row: {
          cli_version: string | null
          id: boolean
          last_seen_at: string
          pause_reason: string | null
          paused_until: string | null
          state: string
          state_since: string
        }
        Insert: {
          cli_version?: string | null
          id?: boolean
          last_seen_at: string
          pause_reason?: string | null
          paused_until?: string | null
          state: string
          state_since: string
        }
        Update: {
          cli_version?: string | null
          id?: boolean
          last_seen_at?: string
          pause_reason?: string | null
          paused_until?: string | null
          state?: string
          state_since?: string
        }
        Relationships: []
      }
      application_events: {
        Row: {
          actor_id: string | null
          application_id: string
          created_at: string
          event_type: Database["public"]["Enums"]["application_event_type"]
          from_status: Database["public"]["Enums"]["application_status"] | null
          id: number
          note: string | null
          reason: string | null
          to_status: Database["public"]["Enums"]["application_status"] | null
        }
        Insert: {
          actor_id?: string | null
          application_id: string
          created_at?: string
          event_type: Database["public"]["Enums"]["application_event_type"]
          from_status?: Database["public"]["Enums"]["application_status"] | null
          id?: never
          note?: string | null
          reason?: string | null
          to_status?: Database["public"]["Enums"]["application_status"] | null
        }
        Update: {
          actor_id?: string | null
          application_id?: string
          created_at?: string
          event_type?: Database["public"]["Enums"]["application_event_type"]
          from_status?: Database["public"]["Enums"]["application_status"] | null
          id?: never
          note?: string | null
          reason?: string | null
          to_status?: Database["public"]["Enums"]["application_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "application_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_killer_answers: {
        Row: {
          answer_boolean: boolean | null
          answer_number: number | null
          answer_text: string | null
          application_id: string
          created_at: string
          id: string
          meets: boolean
          question_id: string
        }
        Insert: {
          answer_boolean?: boolean | null
          answer_number?: number | null
          answer_text?: string | null
          application_id: string
          created_at?: string
          id?: string
          meets: boolean
          question_id: string
        }
        Update: {
          answer_boolean?: boolean | null
          answer_number?: number | null
          answer_text?: string | null
          application_id?: string
          created_at?: string
          id?: string
          meets?: boolean
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_killer_answers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_killer_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "vacancy_killer_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      application_tracking_tokens: {
        Row: {
          application_id: string
          created_at: string
          created_by: string | null
          token: string
        }
        Insert: {
          application_id: string
          created_at?: string
          created_by?: string | null
          token: string
        }
        Update: {
          application_id?: string
          created_at?: string
          created_by?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_tracking_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_tracking_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          applied_at: string
          assigned_evaluator_id: string | null
          candidate_id: string
          created_at: string
          created_by: string | null
          id: string
          intake_method: Database["public"]["Enums"]["application_intake_method"]
          latest_evaluation_id: string | null
          opinion_answered_at: string | null
          opinion_requested_at: string | null
          opinion_requested_by: string | null
          portal_id: string | null
          possible_duplicate_reasons: string[]
          public_reference: string | null
          resume_id: string | null
          status: Database["public"]["Enums"]["application_status"]
          status_changed_at: string
          updated_at: string
          vacancy_id: string
        }
        Insert: {
          applied_at?: string
          assigned_evaluator_id?: string | null
          candidate_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          intake_method?: Database["public"]["Enums"]["application_intake_method"]
          latest_evaluation_id?: string | null
          opinion_answered_at?: string | null
          opinion_requested_at?: string | null
          opinion_requested_by?: string | null
          portal_id?: string | null
          possible_duplicate_reasons?: string[]
          public_reference?: string | null
          resume_id?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          status_changed_at?: string
          updated_at?: string
          vacancy_id: string
        }
        Update: {
          applied_at?: string
          assigned_evaluator_id?: string | null
          candidate_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          intake_method?: Database["public"]["Enums"]["application_intake_method"]
          latest_evaluation_id?: string | null
          opinion_answered_at?: string | null
          opinion_requested_at?: string | null
          opinion_requested_by?: string | null
          portal_id?: string | null
          possible_duplicate_reasons?: string[]
          public_reference?: string | null
          resume_id?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          status_changed_at?: string
          updated_at?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_assigned_evaluator_id_fkey"
            columns: ["assigned_evaluator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_latest_evaluation_fk"
            columns: ["latest_evaluation_id"]
            isOneToOne: false
            referencedRelation: "candidate_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_opinion_requested_by_fkey"
            columns: ["opinion_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "job_portals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_resume_fk"
            columns: ["resume_id","candidate_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id","candidate_id"]
          },
          {
            foreignKeyName: "applications_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          metadata?: Json
        }
        Relationships: []
      }
      bot_status: {
        Row: {
          portal_id: string
          reason: string | null
          seen_at: string
          state: string
        }
        Insert: {
          portal_id: string
          reason?: string | null
          seen_at?: string
          state: string
        }
        Update: {
          portal_id?: string
          reason?: string | null
          seen_at?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_status_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: true
            referencedRelation: "job_portals"
            referencedColumns: ["id"]
          },
        ]
      }
      caleta_prospects: {
        Row: {
          candidate_id: string | null
          contact_channel: Database["public"]["Enums"]["caleta_contact_channel"] | null
          contacted_at: string | null
          created_at: string
          created_by: string | null
          email: string | null
          email_normalized: string | null
          field_origins: Json
          full_name: string
          headline: string | null
          id: string
          linkedin_url: string | null
          location: string | null
          name_normalized: string | null
          notes: string | null
          outreach_message: string | null
          phone: string | null
          phone_normalized: string | null
          profile_text: string | null
          score: number | null
          score_detail: Json | null
          scored_at: string | null
          scoring_version: string | null
          source: Database["public"]["Enums"]["caleta_source"]
          source_detail: string | null
          status: Database["public"]["Enums"]["caleta_status"]
          updated_at: string
          vacancy_id: string
        }
        Insert: {
          candidate_id?: string | null
          contact_channel?: Database["public"]["Enums"]["caleta_contact_channel"] | null
          contacted_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: never
          field_origins?: Json
          full_name: string
          headline?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          name_normalized?: never
          notes?: string | null
          outreach_message?: string | null
          phone?: string | null
          phone_normalized?: never
          profile_text?: string | null
          score?: number | null
          score_detail?: Json | null
          scored_at?: string | null
          scoring_version?: string | null
          source?: Database["public"]["Enums"]["caleta_source"]
          source_detail?: string | null
          status?: Database["public"]["Enums"]["caleta_status"]
          updated_at?: string
          vacancy_id: string
        }
        Update: {
          candidate_id?: string | null
          contact_channel?: Database["public"]["Enums"]["caleta_contact_channel"] | null
          contacted_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: never
          field_origins?: Json
          full_name?: string
          headline?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          name_normalized?: never
          notes?: string | null
          outreach_message?: string | null
          phone?: string | null
          phone_normalized?: never
          profile_text?: string | null
          score?: number | null
          score_detail?: Json | null
          scored_at?: string | null
          scoring_version?: string | null
          source?: Database["public"]["Enums"]["caleta_source"]
          source_detail?: string | null
          status?: Database["public"]["Enums"]["caleta_status"]
          updated_at?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "caleta_prospects_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caleta_prospects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caleta_prospects_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_evaluation_items: {
        Row: {
          assessment: Database["public"]["Enums"]["requirement_assessment"]
          category: Database["public"]["Enums"]["requirement_category"]
          cv_assessment: Database["public"]["Enums"]["requirement_assessment"] | null
          cv_rationale: string | null
          description: string
          engine_assessment: Database["public"]["Enums"]["requirement_assessment"] | null
          evaluation_id: string
          evidence: Json
          id: string
          interview_question: string | null
          is_essential: boolean
          learned_equivalence_id: string | null
          position: number
          priority: Database["public"]["Enums"]["requirement_priority"]
          rationale: string
          requirement_id: string | null
          resolved_by: string | null
          signal: string | null
          verification_note: string | null
          verification_source: Database["public"]["Enums"]["verification_source"] | null
          verified_at: string | null
          verified_by: string | null
          weight: number
        }
        Insert: {
          assessment: Database["public"]["Enums"]["requirement_assessment"]
          category: Database["public"]["Enums"]["requirement_category"]
          cv_assessment?: Database["public"]["Enums"]["requirement_assessment"] | null
          cv_rationale?: string | null
          description: string
          engine_assessment?: Database["public"]["Enums"]["requirement_assessment"] | null
          evaluation_id: string
          evidence?: Json
          id?: string
          interview_question?: string | null
          is_essential: boolean
          learned_equivalence_id?: string | null
          position?: number
          priority: Database["public"]["Enums"]["requirement_priority"]
          rationale: string
          requirement_id?: string | null
          resolved_by?: string | null
          signal?: string | null
          verification_note?: string | null
          verification_source?: Database["public"]["Enums"]["verification_source"] | null
          verified_at?: string | null
          verified_by?: string | null
          weight: number
        }
        Update: {
          assessment?: Database["public"]["Enums"]["requirement_assessment"]
          category?: Database["public"]["Enums"]["requirement_category"]
          cv_assessment?: Database["public"]["Enums"]["requirement_assessment"] | null
          cv_rationale?: string | null
          description?: string
          engine_assessment?: Database["public"]["Enums"]["requirement_assessment"] | null
          evaluation_id?: string
          evidence?: Json
          id?: string
          interview_question?: string | null
          is_essential?: boolean
          learned_equivalence_id?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["requirement_priority"]
          rationale?: string
          requirement_id?: string | null
          resolved_by?: string | null
          signal?: string | null
          verification_note?: string | null
          verification_source?: Database["public"]["Enums"]["verification_source"] | null
          verified_at?: string | null
          verified_by?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "candidate_evaluation_items_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "candidate_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_evaluation_items_learned_equivalence_id_fkey"
            columns: ["learned_equivalence_id"]
            isOneToOne: false
            referencedRelation: "learned_equivalences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_evaluation_items_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "vacancy_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_evaluation_items_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_evaluations: {
        Row: {
          application_id: string
          created_at: string
          created_by: string | null
          criteria_version: number
          evidence_coverage: number
          id: string
          input_sha256: string | null
          level: Database["public"]["Enums"]["compatibility_level"]
          limitations: string[]
          method: Database["public"]["Enums"]["evaluation_method"]
          method_version: string
          model: string | null
          resume_id: string | null
          review_notes: string | null
          review_outcome: Database["public"]["Enums"]["evaluation_review_outcome"] | null
          review_status: Database["public"]["Enums"]["evaluation_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          score: number
          score_potential: number
          scoring_version: string
          summary: string
        }
        Insert: {
          application_id: string
          created_at?: string
          created_by?: string | null
          criteria_version: number
          evidence_coverage: number
          id?: string
          input_sha256?: string | null
          level: Database["public"]["Enums"]["compatibility_level"]
          limitations?: string[]
          method: Database["public"]["Enums"]["evaluation_method"]
          method_version: string
          model?: string | null
          resume_id?: string | null
          review_notes?: string | null
          review_outcome?: Database["public"]["Enums"]["evaluation_review_outcome"] | null
          review_status?: Database["public"]["Enums"]["evaluation_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          score: number
          score_potential: number
          scoring_version: string
          summary: string
        }
        Update: {
          application_id?: string
          created_at?: string
          created_by?: string | null
          criteria_version?: number
          evidence_coverage?: number
          id?: string
          input_sha256?: string | null
          level?: Database["public"]["Enums"]["compatibility_level"]
          limitations?: string[]
          method?: Database["public"]["Enums"]["evaluation_method"]
          method_version?: string
          model?: string | null
          resume_id?: string | null
          review_notes?: string | null
          review_outcome?: Database["public"]["Enums"]["evaluation_review_outcome"] | null
          review_status?: Database["public"]["Enums"]["evaluation_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number
          score_potential?: number
          scoring_version?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_evaluations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_evaluations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_evaluations_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_evaluations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_portal_settings: {
        Row: {
          enabled: boolean
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_portal_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profile_items: {
        Row: {
          candidate_id: string
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          kind: Database["public"]["Enums"]["profile_item_kind"]
          organization: string | null
          origin: Database["public"]["Enums"]["data_origin"]
          source_resume_id: string | null
          start_date: string | null
          title: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          candidate_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          kind: Database["public"]["Enums"]["profile_item_kind"]
          organization?: string | null
          origin?: Database["public"]["Enums"]["data_origin"]
          source_resume_id?: string | null
          start_date?: string | null
          title: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          candidate_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["profile_item_kind"]
          organization?: string | null
          origin?: Database["public"]["Enums"]["data_origin"]
          source_resume_id?: string | null
          start_date?: string | null
          title?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profile_items_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_items_resume_fk"
            columns: ["source_resume_id","candidate_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id","candidate_id"]
          },
          {
            foreignKeyName: "candidate_profile_items_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_tags: {
        Row: {
          assigned_by: string | null
          candidate_id: string
          created_at: string
          id: string
          tag_id: string
        }
        Insert: {
          assigned_by?: string | null
          candidate_id: string
          created_at?: string
          id?: string
          tag_id: string
        }
        Update: {
          assigned_by?: string | null
          candidate_id?: string
          created_at?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_tags_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_tags_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "talent_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          anonymized_at: string | null
          created_at: string
          created_by: string | null
          email: string | null
          email_normalized: string | null
          field_origins: Json
          full_name: string
          id: string
          linkedin_url: string | null
          location: string | null
          name_normalized: string | null
          phone: string | null
          phone_normalized: string | null
          source: Database["public"]["Enums"]["candidate_source"]
          source_detail: string | null
          updated_at: string
        }
        Insert: {
          anonymized_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: never
          field_origins?: Json
          full_name: string
          id?: string
          linkedin_url?: string | null
          location?: string | null
          name_normalized?: never
          phone?: string | null
          phone_normalized?: never
          source?: Database["public"]["Enums"]["candidate_source"]
          source_detail?: string | null
          updated_at?: string
        }
        Update: {
          anonymized_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: never
          field_origins?: Json
          full_name?: string
          id?: string
          linkedin_url?: string | null
          location?: string | null
          name_normalized?: never
          phone?: string | null
          phone_normalized?: never
          source?: Database["public"]["Enums"]["candidate_source"]
          source_detail?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          application_id: string | null
          candidate_id: string
          created_at: string
          granted: boolean
          id: string
          method: Database["public"]["Enums"]["consent_method"]
          notice_id: string
          purpose: Database["public"]["Enums"]["consent_purpose"]
          recorded_by: string | null
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          application_id?: string | null
          candidate_id: string
          created_at?: string
          granted: boolean
          id?: string
          method: Database["public"]["Enums"]["consent_method"]
          notice_id: string
          purpose: Database["public"]["Enums"]["consent_purpose"]
          recorded_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          application_id?: string | null
          candidate_id?: string
          created_at?: string
          granted?: boolean
          id?: string
          method?: Database["public"]["Enums"]["consent_method"]
          notice_id?: string
          purpose?: Database["public"]["Enums"]["consent_purpose"]
          recorded_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "privacy_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_settings: {
        Row: {
          id: boolean
          reply_to: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          reply_to?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          reply_to?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          key: string
          subject: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          key: string
          subject: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          key?: string
          subject?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_batch_items: {
        Row: {
          application_id: string | null
          batch_id: string
          candidate_id: string | null
          created_at: string
          email: string | null
          error_code: string | null
          extraction_method: string | null
          extraction_status: Database["public"]["Enums"]["extraction_status"] | null
          full_name: string | null
          id: string
          mime_type: string | null
          name_from_cv: boolean
          original_filename: string
          phone: string | null
          raw_text: string | null
          sha256: string | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["intake_item_status"]
          storage_path: string | null
          suggested_fields: Json
          updated_at: string
          warnings: string[]
        }
        Insert: {
          application_id?: string | null
          batch_id: string
          candidate_id?: string | null
          created_at?: string
          email?: string | null
          error_code?: string | null
          extraction_method?: string | null
          extraction_status?: Database["public"]["Enums"]["extraction_status"] | null
          full_name?: string | null
          id?: string
          mime_type?: string | null
          name_from_cv?: boolean
          original_filename: string
          phone?: string | null
          raw_text?: string | null
          sha256?: string | null
          size_bytes?: number | null
          status: Database["public"]["Enums"]["intake_item_status"]
          storage_path?: string | null
          suggested_fields?: Json
          updated_at?: string
          warnings?: string[]
        }
        Update: {
          application_id?: string | null
          batch_id?: string
          candidate_id?: string | null
          created_at?: string
          email?: string | null
          error_code?: string | null
          extraction_method?: string | null
          extraction_status?: Database["public"]["Enums"]["extraction_status"] | null
          full_name?: string | null
          id?: string
          mime_type?: string | null
          name_from_cv?: boolean
          original_filename?: string
          phone?: string | null
          raw_text?: string | null
          sha256?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["intake_item_status"]
          storage_path?: string | null
          suggested_fields?: Json
          updated_at?: string
          warnings?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "intake_batch_items_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "intake_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_batch_items_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_batches: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          portal_id: string
          status: Database["public"]["Enums"]["intake_batch_status"]
          vacancy_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          portal_id: string
          status?: Database["public"]["Enums"]["intake_batch_status"]
          vacancy_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          portal_id?: string
          status?: Database["public"]["Enums"]["intake_batch_status"]
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_batches_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "job_portals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_batches_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_submissions: {
        Row: {
          application_id: string | null
          candidate_id: string | null
          duplicate_reasons: string[]
          external_id: string
          id: string
          provider: string
          reason: string | null
          received_at: string
          status: string
          vacancy_id: string | null
        }
        Insert: {
          application_id?: string | null
          candidate_id?: string | null
          duplicate_reasons?: string[]
          external_id: string
          id?: string
          provider: string
          reason?: string | null
          received_at?: string
          status: string
          vacancy_id?: string | null
        }
        Update: {
          application_id?: string | null
          candidate_id?: string | null
          duplicate_reasons?: string[]
          external_id?: string
          id?: string
          provider?: string
          reason?: string | null
          received_at?: string
          status?: string
          vacancy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_submissions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_submissions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_submissions_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_deep_dives: {
        Row: {
          application_id: string
          attempts: number
          available_at: string
          claim_token: string | null
          claimed_at: string | null
          criteria_version: number | null
          error_code: string | null
          evaluation_id: string | null
          finished_at: string | null
          id: string
          model: string | null
          origin: Database["public"]["Enums"]["ai_job_origin"]
          prompt_version: string | null
          questions: Json
          requested_at: string
          requested_by: string | null
          requested_items: Json
          resume_id: string | null
          status: Database["public"]["Enums"]["ai_job_status"]
          updated_at: string
        }
        Insert: {
          application_id: string
          attempts?: number
          available_at?: string
          claim_token?: string | null
          claimed_at?: string | null
          criteria_version?: number | null
          error_code?: string | null
          evaluation_id?: string | null
          finished_at?: string | null
          id?: string
          model?: string | null
          origin: Database["public"]["Enums"]["ai_job_origin"]
          prompt_version?: string | null
          questions?: Json
          requested_at?: string
          requested_by?: string | null
          requested_items?: Json
          resume_id?: string | null
          status?: Database["public"]["Enums"]["ai_job_status"]
          updated_at?: string
        }
        Update: {
          application_id?: string
          attempts?: number
          available_at?: string
          claim_token?: string | null
          claimed_at?: string | null
          criteria_version?: number | null
          error_code?: string | null
          evaluation_id?: string | null
          finished_at?: string | null
          id?: string
          model?: string | null
          origin?: Database["public"]["Enums"]["ai_job_origin"]
          prompt_version?: string | null
          questions?: Json
          requested_at?: string
          requested_by?: string | null
          requested_items?: Json
          resume_id?: string | null
          status?: Database["public"]["Enums"]["ai_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_deep_dives_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_deep_dives_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "candidate_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_deep_dives_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_deep_dives_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_reminders: {
        Row: {
          created_at: string
          interview_id: string
          outcome: Database["public"]["Enums"]["interview_reminder_outcome"]
          recipient: string
          scheduled_at: string
        }
        Insert: {
          created_at?: string
          interview_id: string
          outcome?: Database["public"]["Enums"]["interview_reminder_outcome"]
          recipient: string
          scheduled_at: string
        }
        Update: {
          created_at?: string
          interview_id?: string
          outcome?: Database["public"]["Enums"]["interview_reminder_outcome"]
          recipient?: string
          scheduled_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_reminders_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_scorecards: {
        Row: {
          comment: string | null
          created_at: string
          evaluator_id: string
          id: string
          interview_id: string
          recommendation: Database["public"]["Enums"]["scorecard_recommendation"]
          scores: Json
          updated_at: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          evaluator_id: string
          id?: string
          interview_id: string
          recommendation: Database["public"]["Enums"]["scorecard_recommendation"]
          scores?: Json
          updated_at?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          evaluator_id?: string
          id?: string
          interview_id?: string
          recommendation?: Database["public"]["Enums"]["scorecard_recommendation"]
          scores?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_scorecards_evaluator_id_fkey"
            columns: ["evaluator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_scorecards_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          application_id: string
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          duration_minutes: number
          id: string
          instructions: string | null
          interviewer_emails: string[]
          interviewers: string | null
          location: string | null
          location_lat: number | null
          location_lng: number | null
          modality: Database["public"]["Enums"]["interview_modality"]
          result: Database["public"]["Enums"]["interview_result"] | null
          result_notes: string | null
          result_recorded_at: string | null
          result_recorded_by: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["interview_status"]
          updated_at: string
        }
        Insert: {
          application_id: string
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          id?: string
          instructions?: string | null
          interviewer_emails?: string[]
          interviewers?: string | null
          location?: string | null
          location_lat?: number | null
          location_lng?: number | null
          modality: Database["public"]["Enums"]["interview_modality"]
          result?: Database["public"]["Enums"]["interview_result"] | null
          result_notes?: string | null
          result_recorded_at?: string | null
          result_recorded_by?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["interview_status"]
          updated_at?: string
        }
        Update: {
          application_id?: string
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          id?: string
          instructions?: string | null
          interviewer_emails?: string[]
          interviewers?: string | null
          location?: string | null
          location_lat?: number | null
          location_lng?: number | null
          modality?: Database["public"]["Enums"]["interview_modality"]
          result?: Database["public"]["Enums"]["interview_result"] | null
          result_notes?: string | null
          result_recorded_at?: string | null
          result_recorded_by?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["interview_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_result_recorded_by_fkey"
            columns: ["result_recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_portals: {
        Row: {
          bot_enabled: boolean
          candidate_source: Database["public"]["Enums"]["candidate_source"]
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["job_portal_kind"]
          name: string
          position: number
        }
        Insert: {
          bot_enabled?: boolean
          candidate_source: Database["public"]["Enums"]["candidate_source"]
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["job_portal_kind"]
          name: string
          position?: number
        }
        Update: {
          bot_enabled?: boolean
          candidate_source?: Database["public"]["Enums"]["candidate_source"]
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["job_portal_kind"]
          name?: string
          position?: number
        }
        Relationships: []
      }
      learned_equivalence_votes: {
        Row: {
          application_id: string | null
          candidate_id: string
          created_at: string
          equivalence_id: string
          equivalent: boolean
          rationale: string
        }
        Insert: {
          application_id?: string | null
          candidate_id: string
          created_at?: string
          equivalence_id: string
          equivalent: boolean
          rationale?: string
        }
        Update: {
          application_id?: string | null
          candidate_id?: string
          created_at?: string
          equivalence_id?: string
          equivalent?: boolean
          rationale?: string
        }
        Relationships: [
          {
            foreignKeyName: "learned_equivalence_votes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learned_equivalence_votes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learned_equivalence_votes_equivalence_id_fkey"
            columns: ["equivalence_id"]
            isOneToOne: false
            referencedRelation: "learned_equivalences"
            referencedColumns: ["id"]
          },
        ]
      }
      learned_equivalences: {
        Row: {
          activated_at: string | null
          created_at: string
          cv_term: string
          cv_term_display: string
          id: string
          judge_attempts: number
          judge_claimed_at: string | null
          judge_equivalent: boolean | null
          judge_model: string | null
          judge_reason: string | null
          judge_token: string | null
          judged_at: string | null
          requirement_category: Database["public"]["Enums"]["requirement_category"]
          requirement_description: string
          requirement_key: string
          status: string
          status_changed_at: string
          status_changed_by: string | null
          status_reason: string | null
          updated_at: string
          verdict: string | null
          votes_no: number
          votes_yes: number
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          cv_term: string
          cv_term_display: string
          id?: string
          judge_attempts?: number
          judge_claimed_at?: string | null
          judge_equivalent?: boolean | null
          judge_model?: string | null
          judge_reason?: string | null
          judge_token?: string | null
          judged_at?: string | null
          requirement_category: Database["public"]["Enums"]["requirement_category"]
          requirement_description: string
          requirement_key: string
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          status_reason?: string | null
          updated_at?: string
          verdict?: string | null
          votes_no?: number
          votes_yes?: number
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          cv_term?: string
          cv_term_display?: string
          id?: string
          judge_attempts?: number
          judge_claimed_at?: string | null
          judge_equivalent?: boolean | null
          judge_model?: string | null
          judge_reason?: string | null
          judge_token?: string | null
          judged_at?: string | null
          requirement_category?: Database["public"]["Enums"]["requirement_category"]
          requirement_description?: string
          requirement_key?: string
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          status_reason?: string | null
          updated_at?: string
          verdict?: string | null
          votes_no?: number
          votes_yes?: number
        }
        Relationships: [
          {
            foreignKeyName: "learned_equivalences_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          application_id: string
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["notification_kind"]
          read_at: string | null
          recipient_id: string
        }
        Insert: {
          actor_id?: string | null
          application_id: string
          created_at?: string
          id?: never
          kind: Database["public"]["Enums"]["notification_kind"]
          read_at?: string | null
          recipient_id: string
        }
        Update: {
          actor_id?: string | null
          application_id?: string
          created_at?: string
          id?: never
          kind?: Database["public"]["Enums"]["notification_kind"]
          read_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_publications: {
        Row: {
          attempts: number
          claimed_at: string | null
          error_code: string | null
          external_id: string | null
          external_url: string | null
          id: string
          last_synced_at: string | null
          manual: boolean
          portal_id: string
          published_at: string | null
          requested_at: string
          requested_by: string | null
          status: Database["public"]["Enums"]["portal_publication_status"]
          updated_at: string
          vacancy_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          error_code?: string | null
          external_id?: string | null
          external_url?: string | null
          id?: string
          last_synced_at?: string | null
          manual?: boolean
          portal_id: string
          published_at?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["portal_publication_status"]
          updated_at?: string
          vacancy_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          error_code?: string | null
          external_id?: string | null
          external_url?: string | null
          id?: string
          last_synced_at?: string | null
          manual?: boolean
          portal_id?: string
          published_at?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["portal_publication_status"]
          updated_at?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_publications_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "job_portals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_publications_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_publications_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_notices: {
        Row: {
          approval_reference: string | null
          approved_by: string | null
          body: string
          created_at: string
          created_by: string | null
          effective_from: string | null
          id: string
          status: Database["public"]["Enums"]["privacy_notice_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          approval_reference?: string | null
          approved_by?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          id?: string
          status?: Database["public"]["Enums"]["privacy_notice_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          approval_reference?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          id?: string
          status?: Database["public"]["Enums"]["privacy_notice_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "privacy_notices_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "privacy_notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deactivated_at: string | null
          deleted_at: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          deleted_at?: string | null
          email: string
          full_name: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          deleted_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"] | null
          updated_at?: string
        }
        Relationships: []
      }
      public_form_challenges: {
        Row: {
          challenge_hash: string
          used_at: string
        }
        Insert: {
          challenge_hash: string
          used_at?: string
        }
        Update: {
          challenge_hash?: string
          used_at?: string
        }
        Relationships: []
      }
      requirement_verifications: {
        Row: {
          application_id: string
          id: string
          interview_id: string | null
          note: string
          requirement_id: string
          result: Database["public"]["Enums"]["requirement_assessment"]
          source: Database["public"]["Enums"]["verification_source"]
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          application_id: string
          id?: string
          interview_id?: string | null
          note: string
          requirement_id: string
          result: Database["public"]["Enums"]["requirement_assessment"]
          source: Database["public"]["Enums"]["verification_source"]
          verified_at?: string
          verified_by?: string | null
        }
        Update: {
          application_id?: string
          id?: string
          interview_id?: string | null
          note?: string
          requirement_id?: string
          result?: Database["public"]["Enums"]["requirement_assessment"]
          source?: Database["public"]["Enums"]["verification_source"]
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requirement_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_verifications_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_verifications_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "vacancy_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_extractions: {
        Row: {
          corrected_at: string | null
          corrected_by: string | null
          corrected_text: string | null
          created_at: string
          error_code: string | null
          extractor_version: string
          id: string
          method: string
          raw_text: string | null
          resume_id: string
          status: Database["public"]["Enums"]["extraction_status"]
          suggested_fields: Json
          updated_at: string
          warnings: string[]
        }
        Insert: {
          corrected_at?: string | null
          corrected_by?: string | null
          corrected_text?: string | null
          created_at?: string
          error_code?: string | null
          extractor_version: string
          id?: string
          method: string
          raw_text?: string | null
          resume_id: string
          status: Database["public"]["Enums"]["extraction_status"]
          suggested_fields?: Json
          updated_at?: string
          warnings?: string[]
        }
        Update: {
          corrected_at?: string | null
          corrected_by?: string | null
          corrected_text?: string | null
          created_at?: string
          error_code?: string | null
          extractor_version?: string
          id?: string
          method?: string
          raw_text?: string | null
          resume_id?: string
          status?: Database["public"]["Enums"]["extraction_status"]
          suggested_fields?: Json
          updated_at?: string
          warnings?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "resume_extractions_corrected_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_extractions_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: true
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      resumes: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          is_current: boolean
          mime_type: string
          original_filename: string
          sha256: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          is_current?: boolean
          mime_type: string
          original_filename: string
          sha256: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          is_current?: boolean
          mime_type?: string
          original_filename?: string
          sha256?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "resumes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resumes_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_incident_events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          id: string
          incident_id: string
          kind: Database["public"]["Enums"]["incident_event_kind"]
          occurred_at: string
          recipient: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          incident_id: string
          kind: Database["public"]["Enums"]["incident_event_kind"]
          occurred_at?: string
          recipient?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          incident_id?: string
          kind?: Database["public"]["Enums"]["incident_event_kind"]
          occurred_at?: string
          recipient?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_incident_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_incident_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "security_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      security_incidents: {
        Row: {
          affected_data: string
          affected_people: number | null
          cause: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          detected_at: string
          detected_by_text: string
          id: string
          is_drill: boolean
          prevention: string | null
          review_done_at: string | null
          review_notes: string | null
          sensitive_data: boolean
          severity: Database["public"]["Enums"]["incident_severity"]
          status: Database["public"]["Enums"]["incident_status"]
          title: string
          updated_at: string
        }
        Insert: {
          affected_data?: string
          affected_people?: number | null
          cause?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          detected_at?: string
          detected_by_text?: string
          id?: string
          is_drill?: boolean
          prevention?: string | null
          review_done_at?: string | null
          review_notes?: string | null
          sensitive_data?: boolean
          severity: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
          title: string
          updated_at?: string
        }
        Update: {
          affected_data?: string
          affected_people?: number | null
          cause?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          detected_at?: string
          detected_by_text?: string
          id?: string
          is_drill?: boolean
          prevention?: string | null
          review_done_at?: string | null
          review_notes?: string | null
          sensitive_data?: boolean
          severity?: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_settings: {
        Row: {
          designated_at: string | null
          designated_by: string | null
          id: boolean
          officer_email: string | null
          officer_name: string | null
          updated_at: string
        }
        Insert: {
          designated_at?: string | null
          designated_by?: string | null
          id?: boolean
          officer_email?: string | null
          officer_name?: string | null
          updated_at?: string
        }
        Update: {
          designated_at?: string | null
          designated_by?: string | null
          id?: boolean
          officer_email?: string | null
          officer_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_settings_designated_by_fkey"
            columns: ["designated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      talent_invitations: {
        Row: {
          batch_id: string
          candidate_id: string
          created_at: string
          id: string
          outcome: Database["public"]["Enums"]["talent_invitation_outcome"]
          sent_by: string | null
          vacancy_id: string
        }
        Insert: {
          batch_id: string
          candidate_id: string
          created_at?: string
          id?: string
          outcome: Database["public"]["Enums"]["talent_invitation_outcome"]
          sent_by?: string | null
          vacancy_id: string
        }
        Update: {
          batch_id?: string
          candidate_id?: string
          created_at?: string
          id?: string
          outcome?: Database["public"]["Enums"]["talent_invitation_outcome"]
          sent_by?: string | null
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "talent_invitations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_invitations_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "talent_invitations_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      talent_tags: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "talent_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancies: {
        Row: {
          city: string | null
          closing_date: string | null
          contract_type: string | null
          created_at: string
          created_by: string | null
          criteria_approved_at: string | null
          criteria_approved_by: string | null
          criteria_version: number
          department: string
          description: string
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          first_published_at: string | null
          id: string
          is_confidential: boolean
          location: string | null
          modality: Database["public"]["Enums"]["work_modality"] | null
          opening_date: string | null
          owner_id: string | null
          public_code: string | null
          region: string | null
          responsibilities: string
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          salary_period: Database["public"]["Enums"]["salary_period"] | null
          status: Database["public"]["Enums"]["vacancy_status"]
          title: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          closing_date?: string | null
          contract_type?: string | null
          created_at?: string
          created_by?: string | null
          criteria_approved_at?: string | null
          criteria_approved_by?: string | null
          criteria_version?: number
          department: string
          description?: string
          employment_type?: Database["public"]["Enums"]["employment_type"] | null
          first_published_at?: string | null
          id?: string
          is_confidential?: boolean
          location?: string | null
          modality?: Database["public"]["Enums"]["work_modality"] | null
          opening_date?: string | null
          owner_id?: string | null
          public_code?: string | null
          region?: string | null
          responsibilities?: string
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_period?: Database["public"]["Enums"]["salary_period"] | null
          status?: Database["public"]["Enums"]["vacancy_status"]
          title: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          closing_date?: string | null
          contract_type?: string | null
          created_at?: string
          created_by?: string | null
          criteria_approved_at?: string | null
          criteria_approved_by?: string | null
          criteria_version?: number
          department?: string
          description?: string
          employment_type?: Database["public"]["Enums"]["employment_type"] | null
          first_published_at?: string | null
          id?: string
          is_confidential?: boolean
          location?: string | null
          modality?: Database["public"]["Enums"]["work_modality"] | null
          opening_date?: string | null
          owner_id?: string | null
          public_code?: string | null
          region?: string | null
          responsibilities?: string
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_period?: Database["public"]["Enums"]["salary_period"] | null
          status?: Database["public"]["Enums"]["vacancy_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacancies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancies_criteria_approved_by_fkey"
            columns: ["criteria_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancy_killer_questions: {
        Row: {
          accepted_options: string[] | null
          comparator: Database["public"]["Enums"]["killer_number_comparator"] | null
          created_at: string
          expected_boolean: boolean | null
          help_text: string | null
          id: string
          is_required: boolean
          options: string[] | null
          position: number
          question: string
          question_type: Database["public"]["Enums"]["killer_question_type"]
          requirement_id: string | null
          threshold: number | null
          updated_at: string
          vacancy_id: string
        }
        Insert: {
          accepted_options?: string[] | null
          comparator?: Database["public"]["Enums"]["killer_number_comparator"] | null
          created_at?: string
          expected_boolean?: boolean | null
          help_text?: string | null
          id?: string
          is_required?: boolean
          options?: string[] | null
          position?: number
          question: string
          question_type: Database["public"]["Enums"]["killer_question_type"]
          requirement_id?: string | null
          threshold?: number | null
          updated_at?: string
          vacancy_id: string
        }
        Update: {
          accepted_options?: string[] | null
          comparator?: Database["public"]["Enums"]["killer_number_comparator"] | null
          created_at?: string
          expected_boolean?: boolean | null
          help_text?: string | null
          id?: string
          is_required?: boolean
          options?: string[] | null
          position?: number
          question?: string
          question_type?: Database["public"]["Enums"]["killer_question_type"]
          requirement_id?: string | null
          threshold?: number | null
          updated_at?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacancy_killer_questions_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "vacancy_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancy_killer_questions_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancy_requirements: {
        Row: {
          category: Database["public"]["Enums"]["requirement_category"]
          created_at: string
          description: string
          id: string
          is_essential: boolean
          keywords: string[]
          min_years: number | null
          position: number
          priority: Database["public"]["Enums"]["requirement_priority"]
          updated_at: string
          vacancy_id: string
          weight: number
        }
        Insert: {
          category: Database["public"]["Enums"]["requirement_category"]
          created_at?: string
          description: string
          id?: string
          is_essential?: boolean
          keywords?: string[]
          min_years?: number | null
          position?: number
          priority: Database["public"]["Enums"]["requirement_priority"]
          updated_at?: string
          vacancy_id: string
          weight: number
        }
        Update: {
          category?: Database["public"]["Enums"]["requirement_category"]
          created_at?: string
          description?: string
          id?: string
          is_essential?: boolean
          keywords?: string[]
          min_years?: number | null
          position?: number
          priority?: Database["public"]["Enums"]["requirement_priority"]
          updated_at?: string
          vacancy_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "vacancy_requirements_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      application_overview: {
        Row: {
          applied_at: string | null
          assigned_evaluator_id: string | null
          assigned_evaluator_name: string | null
          candidate_email: string | null
          candidate_id: string | null
          candidate_name: string | null
          criteria_pending_approval: boolean | null
          evaluated_at: string | null
          evaluation_criteria_version: number | null
          evaluation_id: string | null
          evaluation_method: Database["public"]["Enums"]["evaluation_method"] | null
          evaluation_outdated: boolean | null
          evidence_coverage: number | null
          id: string | null
          intake_method: Database["public"]["Enums"]["application_intake_method"] | null
          level: Database["public"]["Enums"]["compatibility_level"] | null
          opinion_answered_at: string | null
          opinion_requested_at: string | null
          portal_id: string | null
          portal_name: string | null
          possible_duplicate_reasons: string[] | null
          review_status: Database["public"]["Enums"]["evaluation_review_status"] | null
          score: number | null
          score_potential: number | null
          status: Database["public"]["Enums"]["application_status"] | null
          status_changed_at: string | null
          top_gaps: string[] | null
          top_met: string[] | null
          top_pending: string[] | null
          vacancy_criteria_version: number | null
          vacancy_id: string | null
          vacancy_status: Database["public"]["Enums"]["vacancy_status"] | null
          vacancy_title: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_privacy_notice: {
        Args: {
          p_id: string | null
          p_approval_reference: string | null
        }
        Returns: number
      }
      add_candidate_to_vacancy: {
        Args: {
          p_candidate_id: string | null
          p_vacancy_id: string | null
        }
        Returns: string
      }
      add_candidates_to_vacancy: {
        Args: {
          p_vacancy_id: string | null
          p_candidate_ids: string[] | null
        }
        Returns: Json
      }
      ai_claim_job: {
        Args: never
        Returns: {
          job_id: string | null
          application_id: string | null
          attempts: number | null
          claim_token: string | null
        }[]
      }
      ai_complete_job: {
        Args: {
          p_job_id: string | null
          p_claim_token: string | null
          p_resume_id: string | null
          p_criteria_version: number | null
          p_method_version: string | null
          p_scoring_version: string | null
          p_model: string | null
          p_score: number | null
          p_score_potential: number | null
          p_evidence_coverage: number | null
          p_level: Database["public"]["Enums"]["compatibility_level"] | null
          p_summary: string | null
          p_limitations: string[] | null
          p_input_sha256: string | null
          p_items: Json | null
        }
        Returns: string
      }
      ai_release_job: {
        Args: {
          p_job_id: string | null
          p_claim_token: string | null
          p_outcome: string | null
          p_error_code?: string | null
          p_retry_at?: string | null
        }
        Returns: Database["public"]["Enums"]["ai_job_status"]
      }
      ai_start_job: {
        Args: {
          p_job_id: string | null
          p_claim_token: string | null
          p_input_sha256: string | null
          p_criteria_version: number | null
        }
        Returns: undefined
      }
      ai_worker_heartbeat: {
        Args: {
          p_state: string | null
          p_reason?: string | null
          p_until?: string | null
          p_cli_version?: string | null
        }
        Returns: boolean
      }
      anonymize_candidate: {
        Args: {
          p_candidate_id: string | null
        }
        Returns: undefined
      }
      apply_resume_ocr: {
        Args: {
          p_resume_id: string | null
          p_status: Database["public"]["Enums"]["extraction_status"] | null
          p_extractor_version: string | null
          p_raw_text: string | null
          p_suggested_fields: Json | null
          p_warnings: string[] | null
          p_error_code: string | null
        }
        Returns: boolean
      }
      approve_vacancy_criteria: {
        Args: {
          p_vacancy_id: string | null
        }
        Returns: number
      }
      batch_item_duplicates: {
        Args: {
          p_batch_id: string | null
        }
        Returns: {
          item_id: string | null
          candidate_id: string | null
          full_name: string | null
          email: string | null
          phone: string | null
          match_reasons: string[] | null
        }[]
      }
      bot_claim_publication: {
        Args: {
          p_portal_id: string | null
        }
        Returns: {
          publication_id: string | null
          action: string | null
          external_id: string | null
          vacancy: Json | null
        }[]
      }
      bot_list_active_publications: {
        Args: {
          p_portal_id: string | null
        }
        Returns: {
          publication_id: string | null
          external_id: string | null
          external_url: string | null
          last_synced_at: string | null
          manual: boolean | null
        }[]
      }
      bot_mark_synced: {
        Args: {
          p_publication_id: string | null
        }
        Returns: undefined
      }
      bot_report_publication: {
        Args: {
          p_publication_id: string | null
          p_outcome: string | null
          p_external_id: string | null
          p_external_url: string | null
          p_error_code: string | null
        }
        Returns: undefined
      }
      bot_report_status: {
        Args: {
          p_portal_id: string | null
          p_state: string | null
          p_reason: string | null
        }
        Returns: undefined
      }
      cancel_interview: {
        Args: {
          p_interview_id: string | null
          p_reason: string | null
        }
        Returns: undefined
      }
      change_application_status: {
        Args: {
          p_application_id: string | null
          p_new_status: Database["public"]["Enums"]["application_status"] | null
          p_reason?: string | null
          p_note?: string | null
        }
        Returns: undefined
      }
      claim_due_interview_reminders: {
        Args: {
          p_hours_before?: number | null
          p_min_notice_hours?: number | null
          p_limit?: number | null
        }
        Returns: {
          interview_id: string | null
          scheduled_at: string | null
          recipient: string | null
        }[]
      }
      close_intake_batch: {
        Args: {
          p_batch_id: string | null
        }
        Returns: string[]
      }
      consume_form_challenge: {
        Args: {
          p_hash: string | null
        }
        Returns: boolean
      }
      consume_integration_rate_limit: {
        Args: {
          p_provider: string | null
          p_vacancy_code: string | null
        }
        Returns: boolean
      }
      consume_public_rate_limit: {
        Args: {
          p_subject: string | null
          p_vacancy_code: string | null
        }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: {
          p_bucket: string | null
        }
        Returns: boolean
      }
      current_privacy_notice: {
        Args: never
        Returns: {
          id: string | null
          version: number | null
          title: string | null
          body: string | null
          effective_from: string | null
        }[]
      }
      deep_dive_claim: {
        Args: never
        Returns: {
          deep_dive_id: string | null
          application_id: string | null
          attempts: number | null
          claim_token: string | null
        }[]
      }
      deep_dive_complete: {
        Args: {
          p_id: string | null
          p_token: string | null
          p_questions: Json | null
          p_model: string | null
          p_prompt_version: string | null
        }
        Returns: number
      }
      deep_dive_release: {
        Args: {
          p_id: string | null
          p_token: string | null
          p_outcome: string | null
          p_error_code?: string | null
          p_retry_at?: string | null
        }
        Returns: Database["public"]["Enums"]["ai_job_status"]
      }
      deep_dive_start: {
        Args: {
          p_id: string | null
          p_token: string | null
          p_evaluation_id: string | null
          p_resume_id: string | null
          p_criteria_version: number | null
          p_requested_items: Json | null
        }
        Returns: undefined
      }
      delete_archived_vacancy: {
        Args: {
          p_vacancy_id: string | null
        }
        Returns: Json
      }
      enqueue_system_ai_evaluation: {
        Args: {
          p_application_id: string | null
        }
        Returns: string
      }
      find_candidate_duplicates: {
        Args: {
          p_email: string | null
          p_phone: string | null
          p_full_name: string | null
          p_exclude_id?: string | null
        }
        Returns: {
          id: string | null
          full_name: string | null
          email: string | null
          phone: string | null
          match_reasons: string[] | null
        }[]
      }
      finish_interview_reminder: {
        Args: {
          p_interview_id: string | null
          p_scheduled_at: string | null
          p_recipient: string | null
          p_outcome: string | null
        }
        Returns: undefined
      }
      get_application_tracking_link: {
        Args: {
          p_application_id: string | null
          p_renew?: boolean | null
        }
        Returns: string
      }
      get_dashboard_summary: {
        Args: never
        Returns: Json
      }
      learn_claim_judgment: {
        Args: never
        Returns: {
          equivalence_id: string | null
          judge_token: string | null
          attempts: number | null
          requirement_category: Database["public"]["Enums"]["requirement_category"] | null
          requirement_description: string | null
          cv_term_display: string | null
          verdict: string | null
          votes: number | null
        }[]
      }
      learn_record_vote: {
        Args: {
          p_requirement_key: string | null
          p_category: Database["public"]["Enums"]["requirement_category"] | null
          p_description: string | null
          p_cv_term: string | null
          p_cv_term_display: string | null
          p_candidate_id: string | null
          p_application_id: string | null
          p_equivalent: boolean | null
          p_rationale: string | null
          p_min_confirmations: number | null
        }
        Returns: string
      }
      learn_release_judgment: {
        Args: {
          p_id: string | null
          p_token: string | null
        }
        Returns: undefined
      }
      learn_report_judgment: {
        Args: {
          p_id: string | null
          p_token: string | null
          p_equivalent: boolean | null
          p_reason: string | null
          p_model: string | null
        }
        Returns: string
      }
      list_inactive_candidates: {
        Args: {
          p_months?: number | null
          p_limit?: number | null
        }
        Returns: {
          candidate_id: string | null
          full_name: string | null
          last_activity: string | null
          applications: number | null
          pool_consent: string | null
        }[]
      }
      list_orphan_resume_files: {
        Args: {
          p_min_age_hours?: number | null
          p_limit?: number | null
        }
        Returns: {
          name: string | null
          updated_at: string | null
        }[]
      }
      log_candidate_message: {
        Args: {
          p_application_id: string | null
          p_subject: string | null
        }
        Returns: undefined
      }
      log_resume_download: {
        Args: {
          p_resume_id: string | null
        }
        Returns: undefined
      }
      log_user_deletion: {
        Args: {
          p_user_id: string | null
        }
        Returns: undefined
      }
      mark_portal_published_manually: {
        Args: {
          p_vacancy_id: string | null
          p_portal_id: string | null
          p_external_id: string | null
          p_external_url?: string | null
        }
        Returns: string
      }
      mark_portal_withdrawn_manually: {
        Args: {
          p_publication_id: string | null
        }
        Returns: undefined
      }
      public_application_status: {
        Args: {
          p_token: string | null
        }
        Returns: Json
      }
      public_killer_questions: {
        Args: {
          p_code: string | null
        }
        Returns: {
          id: string | null
          question: string | null
          question_type: Database["public"]["Enums"]["killer_question_type"] | null
          help_text: string | null
          is_required: boolean | null
          options: string[] | null
        }[]
      }
      public_vacancies: {
        Args: never
        Returns: {
          code: string | null
          title: string | null
          department: string | null
          description: string | null
          responsibilities: string | null
          city: string | null
          region: string | null
          modality: Database["public"]["Enums"]["work_modality"] | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          contract_type: string | null
          salary_min: number | null
          salary_max: number | null
          salary_currency: string | null
          salary_period: Database["public"]["Enums"]["salary_period"] | null
          first_published_at: string | null
          closing_date: string | null
          updated_at: string | null
        }[]
      }
      public_vacancy: {
        Args: {
          p_code: string | null
        }
        Returns: {
          code: string | null
          title: string | null
          department: string | null
          description: string | null
          responsibilities: string | null
          city: string | null
          region: string | null
          modality: Database["public"]["Enums"]["work_modality"] | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          contract_type: string | null
          salary_min: number | null
          salary_max: number | null
          salary_currency: string | null
          salary_period: Database["public"]["Enums"]["salary_period"] | null
          first_published_at: string | null
          closing_date: string | null
          updated_at: string | null
          accepting_applications: boolean | null
        }[]
      }
      public_vacancy_requirements: {
        Args: {
          p_code: string | null
        }
        Returns: {
          description: string | null
          priority: Database["public"]["Enums"]["requirement_priority"] | null
        }[]
      }
      record_evaluation: {
        Args: {
          p_application_id: string | null
          p_resume_id: string | null
          p_criteria_version: number | null
          p_method: Database["public"]["Enums"]["evaluation_method"] | null
          p_method_version: string | null
          p_scoring_version: string | null
          p_model: string | null
          p_score: number | null
          p_score_potential: number | null
          p_evidence_coverage: number | null
          p_level: Database["public"]["Enums"]["compatibility_level"] | null
          p_summary: string | null
          p_limitations: string[] | null
          p_input_sha256: string | null
          p_items: Json | null
        }
        Returns: string
      }
      record_interview_result: {
        Args: {
          p_interview_id: string | null
          p_outcome: string | null
          p_notes?: string | null
          p_verifications?: Json | null
        }
        Returns: string
      }
      record_system_evaluation: {
        Args: {
          p_application_id: string | null
          p_resume_id: string | null
          p_criteria_version: number | null
          p_method: Database["public"]["Enums"]["evaluation_method"] | null
          p_method_version: string | null
          p_scoring_version: string | null
          p_model: string | null
          p_score: number | null
          p_score_potential: number | null
          p_evidence_coverage: number | null
          p_level: Database["public"]["Enums"]["compatibility_level"] | null
          p_summary: string | null
          p_limitations: string[] | null
          p_input_sha256: string | null
          p_items: Json | null
        }
        Returns: string
      }
      record_talent_invitations: {
        Args: {
          p_vacancy_id: string | null
          p_items: Json | null
          p_already_invited?: number | null
        }
        Returns: string
      }
      register_batch_item: {
        Args: {
          p_item_id: string | null
          p_candidate_id: string | null
          p_resume_id: string | null
          p_storage_path: string | null
          p_extractor_version: string | null
        }
        Returns: string
      }
      register_bot_application: {
        Args: {
          p_publication_id: string | null
          p_external_id: string | null
          p_candidate_id: string | null
          p_resume_id: string | null
          p_storage_path: string | null
          p_full_name: string | null
          p_email: string | null
          p_phone: string | null
          p_original_filename: string | null
          p_mime_type: string | null
          p_size_bytes: number | null
          p_sha256: string | null
          p_extraction_status: Database["public"]["Enums"]["extraction_status"] | null
          p_extraction_method: string | null
          p_extractor_version: string | null
          p_raw_text: string | null
          p_suggested_fields: Json | null
          p_warnings: string[] | null
          p_error_code: string | null
        }
        Returns: {
          application_id: string | null
          already_registered: boolean | null
        }[]
      }
      register_integration_application: {
        Args: {
          p_provider: string | null
          p_external_id: string | null
          p_vacancy_code: string | null
          p_candidate_id: string | null
          p_resume_id: string | null
          p_storage_path: string | null
          p_full_name: string | null
          p_email: string | null
          p_phone: string | null
          p_original_filename: string | null
          p_mime_type: string | null
          p_size_bytes: number | null
          p_sha256: string | null
          p_extraction_status: Database["public"]["Enums"]["extraction_status"] | null
          p_extraction_method: string | null
          p_extractor_version: string | null
          p_raw_text: string | null
          p_suggested_fields: Json | null
          p_warnings: string[] | null
          p_error_code: string | null
        }
        Returns: {
          application_id: string | null
          already_registered: boolean | null
        }[]
      }
      register_resume: {
        Args: {
          p_resume_id: string | null
          p_candidate_id: string | null
          p_storage_path: string | null
          p_original_filename: string | null
          p_mime_type: string | null
          p_size_bytes: number | null
          p_sha256: string | null
          p_extraction_status: Database["public"]["Enums"]["extraction_status"] | null
          p_extraction_method: string | null
          p_extractor_version: string | null
          p_raw_text: string | null
          p_suggested_fields: Json | null
          p_warnings: string[] | null
          p_error_code: string | null
        }
        Returns: number
      }
      reject_integration_submission: {
        Args: {
          p_provider: string | null
          p_external_id: string | null
          p_vacancy_code: string | null
          p_reason: string | null
        }
        Returns: undefined
      }
      remove_requirement_verification: {
        Args: {
          p_application_id: string | null
          p_requirement_id: string | null
          p_note: string | null
        }
        Returns: undefined
      }
      request_ai_evaluation: {
        Args: {
          p_application_id: string | null
          p_automatic?: boolean | null
        }
        Returns: string
      }
      request_interview_deep_dive: {
        Args: {
          p_application_id: string | null
          p_automatic?: boolean | null
        }
        Returns: string
      }
      request_opinion: {
        Args: {
          p_application_id: string | null
          p_profile_id: string | null
        }
        Returns: undefined
      }
      request_portal_publication: {
        Args: {
          p_vacancy_id: string | null
          p_portal_id: string | null
        }
        Returns: string
      }
      request_portal_withdrawal: {
        Args: {
          p_publication_id: string | null
        }
        Returns: undefined
      }
      reschedule_interview: {
        Args: {
          p_interview_id: string | null
          p_scheduled_at: string | null
          p_duration_minutes?: number | null
          p_modality?: Database["public"]["Enums"]["interview_modality"] | null
          p_location?: string | null
          p_interviewers?: string | null
          p_instructions?: string | null
        }
        Returns: undefined
      }
      review_evaluation: {
        Args: {
          p_evaluation_id: string | null
          p_outcome: Database["public"]["Enums"]["evaluation_review_outcome"] | null
          p_notes: string | null
        }
        Returns: undefined
      }
      revoke_consent: {
        Args: {
          p_id: string | null
        }
        Returns: undefined
      }
      schedule_interview: {
        Args: {
          p_application_id: string | null
          p_scheduled_at: string | null
          p_duration_minutes?: number | null
          p_modality?: Database["public"]["Enums"]["interview_modality"] | null
          p_location?: string | null
          p_interviewers?: string | null
          p_instructions?: string | null
        }
        Returns: string
      }
      set_interview_coordinates: {
        Args: {
          p_interview_id: string | null
          p_lat: number | null
          p_lng: number | null
        }
        Returns: undefined
      }
      set_interview_interviewer_emails: {
        Args: {
          p_interview_id: string | null
          p_emails: string[] | null
        }
        Returns: undefined
      }
      set_learned_equivalence_active: {
        Args: {
          p_id: string | null
          p_active: boolean | null
        }
        Returns: undefined
      }
      submit_online_application: {
        Args: {
          p_vacancy_code: string | null
          p_notice_id: string | null
          p_portal_name: string | null
          p_accept_talent_pool: boolean | null
          p_candidate_id: string | null
          p_resume_id: string | null
          p_storage_path: string | null
          p_full_name: string | null
          p_email: string | null
          p_phone: string | null
          p_city: string | null
          p_linkedin_url: string | null
          p_original_filename: string | null
          p_mime_type: string | null
          p_size_bytes: number | null
          p_sha256: string | null
          p_extraction_status: Database["public"]["Enums"]["extraction_status"] | null
          p_extraction_method: string | null
          p_extractor_version: string | null
          p_raw_text: string | null
          p_suggested_fields: Json | null
          p_warnings: string[] | null
          p_error_code: string | null
          p_killer_answers?: Json | null
        }
        Returns: {
          application_id: string | null
          public_reference: string | null
        }[]
      }
      verify_requirements: {
        Args: {
          p_application_id: string | null
          p_items: Json | null
        }
        Returns: number
      }
    }
    Enums: {
      ai_job_origin: "automatico" | "manual"
      ai_job_status: "pendiente" | "procesando" | "completado" | "error"
      app_role: "admin" | "rrhh" | "reclutador_caleta"
      application_event_type: "postulacion_creada" | "cambio_estado" | "evaluacion_generada" | "evaluacion_revisada" | "observacion" | "requisito_verificado" | "entrevista_programada" | "entrevista_reprogramada" | "entrevista_cancelada" | "entrevista_resultado" | "correo_enviado"
      application_intake_method: "manual" | "carga_masiva" | "formulario_en_linea" | "integracion" | "cartera"
      application_status: "nuevo" | "en_revision" | "preseleccionado" | "entrevista_programada" | "en_evaluacion" | "seleccionado" | "no_seleccionado" | "en_reserva" | "retirado"
      caleta_contact_channel: "linkedin" | "whatsapp" | "email" | "otro"
      caleta_source: "linkedin" | "cip" | "grupo" | "google" | "referido" | "otro"
      caleta_status: "encontrado" | "contactado" | "conectado" | "respondio" | "interesado" | "descartado" | "derivado"
      candidate_source: "manual" | "bolsa_empleo" | "linkedin" | "referido" | "web_empresa" | "otro"
      compatibility_level: "alta" | "parcial" | "baja" | "pendiente"
      consent_method: "formulario_en_linea" | "registro_manual" | "carga_masiva"
      consent_purpose: "proceso_seleccion" | "cartera_talento"
      data_origin: "declarado" | "extraido" | "verificado"
      employment_type: "tiempo_completo" | "medio_tiempo" | "temporal" | "practicas" | "por_proyecto"
      evaluation_method: "reglas" | "ia"
      evaluation_review_outcome: "conforme" | "con_observaciones" | "requiere_reevaluacion"
      evaluation_review_status: "pendiente_revision" | "revisada"
      extraction_status: "completada" | "sin_texto" | "fallida"
      incident_event_kind: "accion" | "notificacion" | "nota"
      incident_severity: "alta" | "media" | "baja"
      incident_status: "abierto" | "contenido" | "cerrado"
      intake_batch_status: "abierto" | "cerrado"
      intake_item_status: "listo" | "requiere_datos" | "error" | "registrado"
      interview_modality: "presencial" | "virtual" | "telefonica"
      interview_reminder_outcome: "enviando" | "enviado" | "sin_correo"
      interview_result: "paso" | "no_paso"
      interview_status: "programada" | "realizada" | "no_asistio" | "cancelada"
      job_portal_kind: "automatico" | "manual"
      killer_number_comparator: "mayor_igual" | "menor_igual" | "igual"
      killer_question_type: "si_no" | "numero" | "opcion_unica"
      notification_kind: "opinion_solicitada" | "opinion_respondida"
      portal_publication_status: "pendiente" | "publicando" | "publicada" | "retirar" | "retirada" | "error"
      privacy_notice_status: "borrador" | "vigente" | "retirado"
      profile_item_kind: "experiencia" | "formacion" | "habilidad" | "certificacion" | "idioma"
      requirement_assessment: "acreditado" | "no_cumplido" | "sin_evidencia" | "pendiente_verificacion"
      requirement_category: "formacion" | "experiencia" | "habilidad_tecnica" | "herramienta" | "certificacion" | "competencia" | "idioma" | "otro"
      requirement_priority: "obligatorio" | "deseable"
      salary_period: "hora" | "dia" | "semana" | "mes" | "anio"
      scorecard_recommendation: "avanza" | "duda" | "no_avanza"
      talent_invitation_outcome: "enviada" | "sin_correo" | "consentimiento_revocado" | "error"
      vacancy_status: "borrador" | "publicada" | "cerrada" | "archivada"
      verification_source: "entrevista" | "documento" | "referencia" | "prueba_tecnica" | "otro"
      work_modality: "presencial" | "remoto" | "hibrido"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      ai_job_origin: ["automatico", "manual"],
      ai_job_status: ["pendiente", "procesando", "completado", "error"],
      app_role: ["admin", "rrhh", "reclutador_caleta"],
      application_event_type: ["postulacion_creada", "cambio_estado", "evaluacion_generada", "evaluacion_revisada", "observacion", "requisito_verificado", "entrevista_programada", "entrevista_reprogramada", "entrevista_cancelada", "entrevista_resultado", "correo_enviado"],
      application_intake_method: ["manual", "carga_masiva", "formulario_en_linea", "integracion", "cartera"],
      application_status: ["nuevo", "en_revision", "preseleccionado", "entrevista_programada", "en_evaluacion", "seleccionado", "no_seleccionado", "en_reserva", "retirado"],
      caleta_contact_channel: ["linkedin", "whatsapp", "email", "otro"],
      caleta_source: ["linkedin", "cip", "grupo", "google", "referido", "otro"],
      caleta_status: ["encontrado", "contactado", "conectado", "respondio", "interesado", "descartado", "derivado"],
      candidate_source: ["manual", "bolsa_empleo", "linkedin", "referido", "web_empresa", "otro"],
      compatibility_level: ["alta", "parcial", "baja", "pendiente"],
      consent_method: ["formulario_en_linea", "registro_manual", "carga_masiva"],
      consent_purpose: ["proceso_seleccion", "cartera_talento"],
      data_origin: ["declarado", "extraido", "verificado"],
      employment_type: ["tiempo_completo", "medio_tiempo", "temporal", "practicas", "por_proyecto"],
      evaluation_method: ["reglas", "ia"],
      evaluation_review_outcome: ["conforme", "con_observaciones", "requiere_reevaluacion"],
      evaluation_review_status: ["pendiente_revision", "revisada"],
      extraction_status: ["completada", "sin_texto", "fallida"],
      incident_event_kind: ["accion", "notificacion", "nota"],
      incident_severity: ["alta", "media", "baja"],
      incident_status: ["abierto", "contenido", "cerrado"],
      intake_batch_status: ["abierto", "cerrado"],
      intake_item_status: ["listo", "requiere_datos", "error", "registrado"],
      interview_modality: ["presencial", "virtual", "telefonica"],
      interview_reminder_outcome: ["enviando", "enviado", "sin_correo"],
      interview_result: ["paso", "no_paso"],
      interview_status: ["programada", "realizada", "no_asistio", "cancelada"],
      job_portal_kind: ["automatico", "manual"],
      killer_number_comparator: ["mayor_igual", "menor_igual", "igual"],
      killer_question_type: ["si_no", "numero", "opcion_unica"],
      notification_kind: ["opinion_solicitada", "opinion_respondida"],
      portal_publication_status: ["pendiente", "publicando", "publicada", "retirar", "retirada", "error"],
      privacy_notice_status: ["borrador", "vigente", "retirado"],
      profile_item_kind: ["experiencia", "formacion", "habilidad", "certificacion", "idioma"],
      requirement_assessment: ["acreditado", "no_cumplido", "sin_evidencia", "pendiente_verificacion"],
      requirement_category: ["formacion", "experiencia", "habilidad_tecnica", "herramienta", "certificacion", "competencia", "idioma", "otro"],
      requirement_priority: ["obligatorio", "deseable"],
      salary_period: ["hora", "dia", "semana", "mes", "anio"],
      scorecard_recommendation: ["avanza", "duda", "no_avanza"],
      talent_invitation_outcome: ["enviada", "sin_correo", "consentimiento_revocado", "error"],
      vacancy_status: ["borrador", "publicada", "cerrada", "archivada"],
      verification_source: ["entrevista", "documento", "referencia", "prueba_tecnica", "otro"],
      work_modality: ["presencial", "remoto", "hibrido"],
    },
  },
} as const
