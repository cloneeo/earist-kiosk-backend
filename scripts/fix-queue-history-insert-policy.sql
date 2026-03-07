-- Apply this in Supabase SQL Editor for existing deployments.
-- It adds INSERT RLS policies for queue_history so booking metadata writes no longer fail.

ALTER TABLE queue_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow kiosk to insert booking history" ON queue_history;
CREATE POLICY "Allow kiosk to insert booking history"
  ON queue_history FOR INSERT
  WITH CHECK (
    action IN ('booked', 'concern_submitted', 'student_identified', 'slot_selected')
    AND queue_entry_id IN (
      SELECT id FROM queue_entries
    )
  );

DROP POLICY IF EXISTS "Allow faculty to insert queue history" ON queue_history;
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
