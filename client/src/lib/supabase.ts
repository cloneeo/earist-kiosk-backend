import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
      colleges: {
        Row: {
          id: string;
          name: string;
          code: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          name: string;
          code: string;
        };
        Update: {
          name?: string;
          code?: string;
        };
      };
      departments: {
        Row: {
          id: string;
          college_id: string;
          name: string;
          code: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          college_id: string;
          name: string;
          code: string;
        };
        Update: {
          college_id?: string;
          name?: string;
          code?: string;
        };
      };
      faculty: {
        Row: {
          schedule: string;
          consultation_method: "face_to_face" | "online";
          id: string;
          department_id: string;
          user_id: string;
          name: string;
          email: string;
          status: "accepting" | "on_break" | "offline";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          department_id: string;
          user_id: string;
          name: string;
          email: string;
          status?: "accepting" | "on_break" | "offline";
          consultation_method?: "face_to_face" | "online";
        };
        Update: {
          status?: "accepting" | "on_break" | "offline";
          name?: string;
          consultation_method?: "face_to_face" | "online";
        };
      };
      queue_entries: {
        Row: {
          id: string;
          faculty_id: string;
          student_number: string;
          consultation_type: "face_to_face" | "google_meet";
          status: "waiting" | "called" | "completed" | "cancelled" | "rescheduled";
          position: number | null;
          estimated_wait_time: number | null;
          called_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          faculty_id: string;
          student_number: string;
          consultation_type: "face_to_face" | "google_meet";
          status?: "waiting" | "called" | "completed" | "cancelled" | "rescheduled";
          position?: number;
          estimated_wait_time?: number;
        };
        Update: {
          status?: "waiting" | "called" | "completed" | "cancelled" | "rescheduled";
          position?: number;
          estimated_wait_time?: number;
          called_at?: string;
          completed_at?: string;
        };
      };
      queue_history: {
        Row: {
          id: string;
          queue_entry_id: string;
          action: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          queue_entry_id: string;
          action: string;
          notes?: string;
        };
      };
    };
  };
};
