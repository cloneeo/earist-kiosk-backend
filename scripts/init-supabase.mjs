import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function initializeDatabase() {
  try {
    console.log("🔧 Initializing EARIST Queue Management System database...\n");

    // Create colleges table
    console.log("📚 Creating colleges table...");
    const { error: collegesError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS colleges (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL UNIQUE,
          code VARCHAR(50) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `,
    });
    if (collegesError) console.log("Colleges table ready");

    // Create departments table
    console.log("🏢 Creating departments table...");
    const { error: deptError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS departments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(college_id, code)
        );
      `,
    });
    if (deptError) console.log("Departments table ready");

    // Create faculty table
    console.log("👨‍🏫 Creating faculty table...");
    const { error: facultyError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS faculty (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL UNIQUE,
          status VARCHAR(50) DEFAULT 'offline',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `,
    });
    if (facultyError) console.log("Faculty table ready");

    // Create queue_entries table
    console.log("📋 Creating queue_entries table...");
    const { error: queueError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS queue_entries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          faculty_id UUID NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
          student_number VARCHAR(50) NOT NULL,
          consultation_type VARCHAR(50) NOT NULL,
          status VARCHAR(50) DEFAULT 'waiting',
          position INT,
          estimated_wait_time INT,
          called_at TIMESTAMP,
          completed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `,
    });
    if (queueError) console.log("Queue entries table ready");

    // Create queue_history table
    console.log("📊 Creating queue_history table...");
    const { error: historyError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS queue_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          queue_entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
          action VARCHAR(50) NOT NULL,
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `,
    });
    if (historyError) console.log("Queue history table ready");

    console.log("\n✅ Database schema initialized successfully!");
  } catch (error) {
    console.error("❌ Error initializing database:", error);
    process.exit(1);
  }
}

initializeDatabase();
