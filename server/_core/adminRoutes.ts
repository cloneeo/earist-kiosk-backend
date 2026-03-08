import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminDeleteTable = "faculty" | "departments" | "colleges";

type SendEmailResult = {
  ok: boolean;
  message?: string;
};

const ADMIN_EMAILS = new Set(["admin@earist.edu.ph", "adminj@earist.edu.ph"]);

const supabaseUrl =
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const sendGridApiKey = process.env.SENDGRID_API_KEY || "";
const sendGridFrom = process.env.SENDGRID_FROM || process.env.BOOKING_EMAIL_FROM || "";

const hasSendGridConfig = !!sendGridApiKey && !!sendGridFrom;

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

function generateTemporaryPassword(length = 12): string {
  const passwordChars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$";
  return Array.from({ length }, () => passwordChars[Math.floor(Math.random() * passwordChars.length)]).join("");
}

async function sendTemporaryPasswordEmail(
  toEmail: string,
  facultyName: string,
  temporaryPassword: string,
): Promise<SendEmailResult> {
  if (!hasSendGridConfig) {
    return { ok: false, message: "SendGrid not configured (SENDGRID_API_KEY / SENDGRID_FROM)." };
  }

  const loginUrl = `${process.env.APP_URL || process.env.PUBLIC_APP_URL || "http://localhost:3000"}/login`;

  const subject = "EARIST Faculty Portal Account Created";
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
      <h2 style="margin-bottom: 12px;">Faculty Portal Account Created</h2>
      <p>Hello ${facultyName || "Professor"},</p>
      <p>Your EARIST Faculty Portal account is ready.</p>
      <ul>
        <li><strong>Email:</strong> ${toEmail}</li>
        <li><strong>Temporary Password:</strong> ${temporaryPassword}</li>
        <li><strong>Login Page:</strong> <a href="${loginUrl}">${loginUrl}</a></li>
      </ul>
      <p>Please sign in and change your password immediately after first login.</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendGridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: sendGridFrom },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, message: detail || `SendGrid rejected request (${response.status}).` };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Email request failed.",
    };
  }
}

async function validateAdminRequest(req: Request): Promise<{ ok: true; email: string } | { ok: false; status: number; error: string }> {
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      status: 500,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).",
    };
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing authorization token." };
  }

  const requesterEmail = await verifyAdminEmail(accessToken);
  if (!requesterEmail || !ADMIN_EMAILS.has(requesterEmail)) {
    return { ok: false, status: 403, error: "Admin access required." };
  }

  return { ok: true, email: requesterEmail };
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
  app.post("/api/admin/faculty/create", async (req: Request, res: Response) => {
    try {
      const auth = await validateAdminRequest(req);
      if (!auth.ok) {
        return res.status(auth.status).json({ error: auth.error });
      }

      const name = String(req.body?.name || "").trim();
      const email = String(req.body?.email || "").trim().toLowerCase();
      const departmentId = String(req.body?.department_id || "").trim();

      if (!name || !email || !departmentId) {
        return res.status(400).json({ error: "Missing required fields: name, email, department_id." });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid faculty email address." });
      }

      const adminClient = createClient(supabaseUrl!, serviceRoleKey!, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      const temporaryPassword = generateTemporaryPassword();

      const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { role: "faculty", full_name: name },
      });

      if (createUserError) {
        return res.status(400).json({ error: createUserError.message || "Failed to create faculty auth user." });
      }

      const userId = createdUser.user?.id;
      if (!userId) {
        return res.status(500).json({ error: "Auth user was created without an ID." });
      }

      const { error: insertFacultyError } = await adminClient.from("faculty").insert({
        user_id: userId,
        name,
        email,
        department_id: departmentId,
        status: "offline",
      });

      if (insertFacultyError) {
        await adminClient.auth.admin.deleteUser(userId);
        return res.status(400).json({ error: insertFacultyError.message || "Failed to save faculty profile." });
      }

      const emailResult = await sendTemporaryPasswordEmail(email, name, temporaryPassword);
      return res.json({
        success: true,
        emailSent: emailResult.ok,
        emailWarning: emailResult.ok ? undefined : emailResult.message,
      });
    } catch (error: any) {
      console.error("[Admin Faculty Create] Failed:", error);
      return res.status(500).json({ error: error?.message || "Failed to create faculty account." });
    }
  });

  app.post("/api/admin/delete", async (req: Request, res: Response) => {
    try {
      const auth = await validateAdminRequest(req);
      if (!auth.ok) {
        return res.status(auth.status).json({ error: auth.error });
      }

      const table = req.body?.table as AdminDeleteTable;
      const id = req.body?.id as string | undefined;

      if (!id || !["faculty", "departments", "colleges"].includes(table)) {
        return res.status(400).json({ error: "Invalid delete payload." });
      }

      const adminClient = createClient(supabaseUrl!, serviceRoleKey!, {
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
