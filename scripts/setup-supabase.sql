-- EARIST Queue Management System - Supabase Setup Script
-- This script creates all necessary tables, authentication setup, and RLS policies

-- ============================================================================
-- 1. CREATE COLLEGES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS colleges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE colleges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to colleges"
  ON colleges FOR SELECT
  USING (true);

-- ============================================================================
-- 2. CREATE DEPARTMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(college_id, code)
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to departments"
  ON departments FOR SELECT
  USING (true);

CREATE POLICY "Allow admin to manage departments"
  ON departments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- ============================================================================
-- 3. CREATE FACULTY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS faculty (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(50) DEFAULT 'offline' CHECK (status IN ('accepting', 'on_break', 'offline')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE faculty ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to faculty"
  ON faculty FOR SELECT
  USING (true);

CREATE POLICY "Allow faculty to update their own status"
  ON faculty FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow admin to manage faculty"
  ON faculty FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- ============================================================================
-- 4. CREATE QUEUE_ENTRIES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id UUID NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  student_number VARCHAR(50) NOT NULL,
  consultation_type VARCHAR(50) NOT NULL CHECK (consultation_type IN ('face_to_face', 'google_meet')),
  status VARCHAR(50) DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'completed', 'cancelled', 'rescheduled')),
  position INT,
  estimated_wait_time INT,
  called_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to queue entries"
  ON queue_entries FOR SELECT
  USING (true);

CREATE POLICY "Allow faculty to manage their queue"
  ON queue_entries FOR ALL
  USING (
    faculty_id IN (
      SELECT id FROM faculty WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Allow admin to manage all queues"
  ON queue_entries FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- ============================================================================
-- 5. CREATE QUEUE_HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS queue_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE queue_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to queue history"
  ON queue_history FOR SELECT
  USING (true);

CREATE POLICY "Allow faculty to view their queue history"
  ON queue_history FOR SELECT
  USING (
    queue_entry_id IN (
      SELECT id FROM queue_entries
      WHERE faculty_id IN (
        SELECT id FROM faculty WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Allow kiosk to insert booking history"
  ON queue_history FOR INSERT
  WITH CHECK (
    action IN ('booked', 'concern_submitted', 'student_identified', 'slot_selected')
    AND queue_entry_id IN (
      SELECT id FROM queue_entries
    )
  );

CREATE POLICY "Allow faculty to insert queue history"
  ON queue_history FOR INSERT
  WITH CHECK (
    queue_entry_id IN (
      SELECT id FROM queue_entries
      WHERE faculty_id IN (
        SELECT id FROM faculty WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================================================
-- 6. CREATE INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_departments_college_id ON departments(college_id);
CREATE INDEX IF NOT EXISTS idx_faculty_department_id ON faculty(department_id);
CREATE INDEX IF NOT EXISTS idx_faculty_user_id ON faculty(user_id);
CREATE INDEX IF NOT EXISTS idx_queue_entries_faculty_id ON queue_entries(faculty_id);
CREATE INDEX IF NOT EXISTS idx_queue_entries_status ON queue_entries(status);
CREATE INDEX IF NOT EXISTS idx_queue_entries_created_at ON queue_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_queue_history_queue_entry_id ON queue_history(queue_entry_id);

-- ============================================================================
-- 7. SEED INITIAL DATA
-- ============================================================================

-- Insert sample colleges
INSERT INTO colleges (name, code) VALUES
  ('College of Engineering', 'COE'),
  ('College of Science', 'COS'),
  ('College of Arts and Sciences', 'CAS')
ON CONFLICT (code) DO NOTHING;

-- Insert sample departments
INSERT INTO departments (college_id, name, code)
SELECT id, 'Computer Science', 'CS' FROM colleges WHERE code = 'COE'
ON CONFLICT (college_id, code) DO NOTHING;

INSERT INTO departments (college_id, name, code)
SELECT id, 'Information Technology', 'IT' FROM colleges WHERE code = 'COE'
ON CONFLICT (college_id, code) DO NOTHING;

INSERT INTO departments (college_id, name, code)
SELECT id, 'Civil Engineering', 'CE' FROM colleges WHERE code = 'COE'
ON CONFLICT (college_id, code) DO NOTHING;

INSERT INTO departments (college_id, name, code)
SELECT id, 'Biology', 'BIO' FROM colleges WHERE code = 'COS'
ON CONFLICT (college_id, code) DO NOTHING;

INSERT INTO departments (college_id, name, code)
SELECT id, 'Chemistry', 'CHEM' FROM colleges WHERE code = 'COS'
ON CONFLICT (college_id, code) DO NOTHING;

-- ============================================================================
-- 8. NOTES FOR MANUAL SETUP
-- ============================================================================
-- After running this script:
-- 1. Create auth users in Supabase Auth:
--    - admin@earist.edu.ph (password: admin123) - Set role to 'admin'
--    - faculty1@earist.edu.ph (password: faculty123) - Set role to 'faculty'
--
-- 2. Create corresponding faculty records:
--    INSERT INTO faculty (department_id, user_id, name, email, status)
--    SELECT id, '<faculty_user_id>', 'Dr. Juan Dela Cruz', 'faculty1@earist.edu.ph', 'offline'
--    FROM departments WHERE code = 'CS';
--
-- 3. Enable Realtime for these tables in Supabase dashboard:
--    - queue_entries
--    - faculty
--    - queue_history
