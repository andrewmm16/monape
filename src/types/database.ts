// ARCHIVO GENERADO por scripts/gen-db-types.ts a partir de supabase/migrations.
// No editar manualmente: ejecutar `npm run db:types`.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13"
  }
  public: {
    Tables: {
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
      candidate_evaluation_items: {
        Row: {
          assessment: Database["public"]["Enums"]["requirement_assessment"]
          category: Database["public"]["Enums"]["requirement_category"]
          description: string
          evaluation_id: string
          evidence: Json
          id: string
          is_essential: boolean
          position: number
          priority: Database["public"]["Enums"]["requirement_priority"]
          rationale: string
          requirement_id: string | null
          weight: number
        }
        Insert: {
          assessment: Database["public"]["Enums"]["requirement_assessment"]
          category: Database["public"]["Enums"]["requirement_category"]
          description: string
          evaluation_id: string
          evidence?: Json
          id?: string
          is_essential: boolean
          position?: number
          priority: Database["public"]["Enums"]["requirement_priority"]
          rationale: string
          requirement_id?: string | null
          weight: number
        }
        Update: {
          assessment?: Database["public"]["Enums"]["requirement_assessment"]
          category?: Database["public"]["Enums"]["requirement_category"]
          description?: string
          evaluation_id?: string
          evidence?: Json
          id?: string
          is_essential?: boolean
          position?: number
          priority?: Database["public"]["Enums"]["requirement_priority"]
          rationale?: string
          requirement_id?: string | null
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
            foreignKeyName: "candidate_evaluation_items_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "vacancy_requirements"
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
      candidates: {
        Row: {
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
      job_portals: {
        Row: {
          candidate_source: Database["public"]["Enums"]["candidate_source"]
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["job_portal_kind"]
          name: string
          position: number
        }
        Insert: {
          candidate_source: Database["public"]["Enums"]["candidate_source"]
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["job_portal_kind"]
          name: string
          position?: number
        }
        Update: {
          candidate_source?: Database["public"]["Enums"]["candidate_source"]
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["job_portal_kind"]
          name?: string
          position?: number
        }
        Relationships: []
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
      change_application_status: {
        Args: {
          p_application_id: string | null
          p_new_status: Database["public"]["Enums"]["application_status"] | null
          p_reason?: string | null
          p_note?: string | null
        }
        Returns: undefined
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
      get_dashboard_summary: {
        Args: never
        Returns: Json
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
      request_opinion: {
        Args: {
          p_application_id: string | null
          p_profile_id: string | null
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
        }
        Returns: {
          application_id: string | null
          public_reference: string | null
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "rrhh"
      application_event_type: "postulacion_creada" | "cambio_estado" | "evaluacion_generada" | "evaluacion_revisada" | "observacion"
      application_intake_method: "manual" | "carga_masiva" | "formulario_en_linea" | "integracion"
      application_status: "nuevo" | "en_revision" | "preseleccionado" | "entrevista_programada" | "en_evaluacion" | "seleccionado" | "no_seleccionado" | "en_reserva" | "retirado"
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
      intake_batch_status: "abierto" | "cerrado"
      intake_item_status: "listo" | "requiere_datos" | "error" | "registrado"
      job_portal_kind: "automatico" | "manual"
      notification_kind: "opinion_solicitada" | "opinion_respondida"
      privacy_notice_status: "borrador" | "vigente" | "retirado"
      profile_item_kind: "experiencia" | "formacion" | "habilidad" | "certificacion" | "idioma"
      requirement_assessment: "acreditado" | "no_cumplido" | "sin_evidencia" | "pendiente_verificacion"
      requirement_category: "formacion" | "experiencia" | "habilidad_tecnica" | "herramienta" | "certificacion" | "competencia" | "idioma" | "otro"
      requirement_priority: "obligatorio" | "deseable"
      salary_period: "hora" | "dia" | "semana" | "mes" | "anio"
      vacancy_status: "borrador" | "publicada" | "cerrada" | "archivada"
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
      app_role: ["admin", "rrhh"],
      application_event_type: ["postulacion_creada", "cambio_estado", "evaluacion_generada", "evaluacion_revisada", "observacion"],
      application_intake_method: ["manual", "carga_masiva", "formulario_en_linea", "integracion"],
      application_status: ["nuevo", "en_revision", "preseleccionado", "entrevista_programada", "en_evaluacion", "seleccionado", "no_seleccionado", "en_reserva", "retirado"],
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
      intake_batch_status: ["abierto", "cerrado"],
      intake_item_status: ["listo", "requiere_datos", "error", "registrado"],
      job_portal_kind: ["automatico", "manual"],
      notification_kind: ["opinion_solicitada", "opinion_respondida"],
      privacy_notice_status: ["borrador", "vigente", "retirado"],
      profile_item_kind: ["experiencia", "formacion", "habilidad", "certificacion", "idioma"],
      requirement_assessment: ["acreditado", "no_cumplido", "sin_evidencia", "pendiente_verificacion"],
      requirement_category: ["formacion", "experiencia", "habilidad_tecnica", "herramienta", "certificacion", "competencia", "idioma", "otro"],
      requirement_priority: ["obligatorio", "deseable"],
      salary_period: ["hora", "dia", "semana", "mes", "anio"],
      vacancy_status: ["borrador", "publicada", "cerrada", "archivada"],
      work_modality: ["presencial", "remoto", "hibrido"],
    },
  },
} as const
