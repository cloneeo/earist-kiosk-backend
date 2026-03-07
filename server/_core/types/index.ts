export interface QueueEntry {
  id: string;
  student_number: string;
  faculty_id: string;
  status: 'waiting' | 'called' | 'completed' | 'skipped';
  called_at?: string;
  created_at: string;
}

export interface FacultyProfile {
  id: string;
  user_id: string;
  name: string;
  status: string;
  is_paused: boolean;
  department?: { name: string };
}

export interface FacultyAvailability {
  id: string;
  faculty_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface FacultyUnavailableDate {
  id: string;
  faculty_id: string;
  unavailable_date: string;
  reason?: string;
}