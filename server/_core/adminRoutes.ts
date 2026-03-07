import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminDeleteTable = "faculty" | "departments" | "colleges";

const ADMIN_EMAILS = new Set(["admin@earist.edu.ph", "adminj@earist.edu.ph"]);

const supabaseUrl =
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function getBearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function verifyAdminEmail(accessToken: string): Promise<string | null> {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as { email?: string };
  if (!payload.email) return null;

  return payload.email.toLowerCase();
}

async function deleteFacultyAuthUsers(
  adminClient: SupabaseClient,
  userIds: string[],
) {
  // Remove auth users after row deletion to avoid partial state if auth deletion fails.
  const uniqueUserIds = Array.from(new Set(userIds));
  for (const userId of uniqueUserIds) {
    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) {
      console.error(`[Admin Delete] Failed to delete auth user ${userId}:`, error.message);
    }
  }
}

export function registerAdminRoutes(app: Express) {
  app.post("/api/admin/delete", async (req: Request, res: Response) => {
    try {
      if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({
          error:
            "Server is missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).",
        });
      }

      const accessToken = getBearerToken(req);
      if (!accessToken) {
        return res.status(401).json({ error: "Missing authorization token." });
      }

      const requesterEmail = await verifyAdminEmail(accessToken);
      if (!requesterEmail || !ADMIN_EMAILS.has(requesterEmail)) {
        return res.status(403).json({ error: "Admin access required." });
      }

      const table = req.body?.table as AdminDeleteTable;
      const id = req.body?.id as string | undefined;

      if (!id || !["faculty", "departments", "colleges"].includes(table)) {
        return res.status(400).json({ error: "Invalid delete payload." });
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      if (table === "faculty") {
        const { data: facultyRow, error: facultyLookupError } = await adminClient
          .from("faculty")
          .select("user_id")
          .eq("id", id)
          .maybeSingle();
        if (facultyLookupError) throw facultyLookupError;

        const { error: facultyDeleteError } = await adminClient
          .from("faculty")
          .delete()
          .eq("id", id);
        if (facultyDeleteError) throw facultyDeleteError;

        if (facultyRow?.user_id) {
          await deleteFacultyAuthUsers(adminClient, [facultyRow.user_id]);
        }
      }

      if (table === "departments") {
        const { data: departmentFaculty, error: facultyLookupError } = await adminClient
          .from("faculty")
          .select("user_id")
          .eq("department_id", id);
        if (facultyLookupError) throw facultyLookupError;

        const userIds = (departmentFaculty || [])
          .map((row) => row.user_id)
          .filter((row): row is string => !!row);

        const { error: departmentDeleteError } = await adminClient
          .from("departments")
          .delete()
          .eq("id", id);
        if (departmentDeleteError) throw departmentDeleteError;

        await deleteFacultyAuthUsers(adminClient, userIds);
      }

      if (table === "colleges") {
        const { data: departmentRows, error: departmentLookupError } = await adminClient
          .from("departments")
          .select("id")
          .eq("college_id", id);
        if (departmentLookupError) throw departmentLookupError;

        const departmentIds = (departmentRows || []).map((row) => row.id);
        let userIds: string[] = [];

        if (departmentIds.length > 0) {
          const { data: facultyRows, error: facultyLookupError } = await adminClient
            .from("faculty")
            .select("user_id")
            .in("department_id", departmentIds);
          if (facultyLookupError) throw facultyLookupError;

          userIds = (facultyRows || [])
            .map((row) => row.user_id)
            .filter((row): row is string => !!row);
        }

        const { error: collegeDeleteError } = await adminClient
          .from("colleges")
          .delete()
          .eq("id", id);
        if (collegeDeleteError) throw collegeDeleteError;

        await deleteFacultyAuthUsers(adminClient, userIds);
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error("[Admin Delete] Failed:", error);
      return res
        .status(500)
        .json({ error: error?.message || "Failed to delete record." });
    }
  });
}
