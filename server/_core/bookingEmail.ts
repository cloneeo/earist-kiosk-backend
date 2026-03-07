import type { Express } from "express";
import nodemailer from "nodemailer";

type QueueEntryRow = {
  id: string;
  student_number: string;
  consultation_type: string;
  created_at: string;
  faculty_id: string;
};

type FacultyRow = {
  id: string;
  name: string;
};

type StudentRow = {
  full_name?: string | null;
  email?: string | null;
  student_email?: string | null;
};

type SupabaseListResponse<T> = {
  data: T[] | null;
  error?: { message?: string } | null;
};

type SendEmailResult = {
  ok: boolean;
  message?: string;
};

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpSecure = String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true" || smtpPort === 465;
const bookingEmailFrom = process.env.BOOKING_EMAIL_FROM || "";
const smtpConnectionTimeoutMs = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 30000);
const smtpGreetingTimeoutMs = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 30000);
const smtpSocketTimeoutMs = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 60000);

const supabaseRestKey = supabaseServiceRoleKey || supabaseAnonKey;
const hasSupabaseConfig = !!supabaseUrl && !!supabaseRestKey;
const hasSmtpConfig = !!smtpHost && !!smtpPort && !!smtpUser && !!smtpPass;
const isGmailHost = /gmail\.com$/i.test(smtpHost);

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const randomMeetChunk = (length: number) => {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
};

const createRandomGoogleMeetLink = () =>
  `https://meet.google.com/${randomMeetChunk(3)}-${randomMeetChunk(4)}-${randomMeetChunk(3)}`;

const supabaseFetch = async <T>(path: string): Promise<SupabaseListResponse<T>> => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: supabaseRestKey,
      Authorization: `Bearer ${supabaseRestKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      data: null,
      error: { message: detail || `Supabase request failed (${response.status})` },
    };
  }

  const data = (await response.json()) as T[];
  return { data };
};

const resolveStudentName = (student: StudentRow | null, fallbackStudentNumber: string): string => {
  const value =
    student?.full_name?.trim() ||
    fallbackStudentNumber;

  return value;
};

const resolveStudentEmail = (student: StudentRow | null): string | null => {
  const candidate = student?.email?.trim() || student?.student_email?.trim() || "";
  if (!candidate) return null;
  return candidate;
};

const resolveFallbackEmail = (value: unknown): string | null => {
  const candidate = String(value || "").trim().toLowerCase();
  if (!candidate) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null;
  return candidate;
};

const sendBookingEmail = async (toEmail: string, subject: string, html: string): Promise<SendEmailResult> => {
  if (!hasSmtpConfig || !bookingEmailFrom) {
    return { ok: false, message: "SMTP email settings are not configured." };
  }

  const transportConfigs: any[] = [
    {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: smtpConnectionTimeoutMs,
      greetingTimeout: smtpGreetingTimeoutMs,
      socketTimeout: smtpSocketTimeoutMs,
    },
  ];

  if (isGmailHost) {
    transportConfigs.push(
      {
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: smtpConnectionTimeoutMs,
        greetingTimeout: smtpGreetingTimeoutMs,
        socketTimeout: smtpSocketTimeoutMs,
      },
      {
        service: "gmail",
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: smtpConnectionTimeoutMs,
        greetingTimeout: smtpGreetingTimeoutMs,
        socketTimeout: smtpSocketTimeoutMs,
      },
    );
  }

  let lastErrorMessage = "SMTP send failed.";

  try {
    for (const config of transportConfigs) {
      try {
        const transporter = nodemailer.createTransport(config);
        await transporter.sendMail({
          from: bookingEmailFrom,
          to: toEmail,
          subject,
          html,
        });
        return { ok: true };
      } catch (error) {
        lastErrorMessage = error instanceof Error ? error.message : "SMTP send failed.";
      }
    }
    return { ok: false, message: lastErrorMessage };
  } catch (error) {
    lastErrorMessage = error instanceof Error ? error.message : "SMTP send failed.";
    return { ok: false, message: lastErrorMessage };
  }
};

const insertQueueHistory = async (queueEntryId: string, action: string, notes: string) => {
  await fetch(`${supabaseUrl}/rest/v1/queue_history`, {
    method: "POST",
    headers: {
      apikey: supabaseRestKey,
      Authorization: `Bearer ${supabaseRestKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([
      {
        queue_entry_id: queueEntryId,
        action,
        notes,
      },
    ]),
  }).catch(() => {
    // History insert is best-effort and must not break email delivery.
  });
};

export function registerBookingEmailRoutes(app: Express) {
  app.post("/api/booking/email", async (req, res) => {
    try {
      const queueId = String(req.body?.queueId || "").trim();
      const fallbackEmail = resolveFallbackEmail(req.body?.studentEmail);

      if (!queueId || !isUuid(queueId)) {
        return res.status(400).json({ ok: false, message: "Invalid queueId." });
      }

      if (!hasSupabaseConfig) {
        return res.status(200).json({ ok: false, skipped: true, message: "Supabase config missing." });
      }

      const queueResponse = await supabaseFetch<QueueEntryRow>(
        `queue_entries?select=id,student_number,consultation_type,created_at,faculty_id&id=eq.${queueId}&limit=1`
      );

      if (queueResponse.error) {
        return res.status(500).json({
          ok: false,
          message: `Unable to read queue entry: ${queueResponse.error.message || "unknown error"}`,
        });
      }

      const queueEntry = queueResponse.data?.[0] || null;
      if (!queueEntry) {
        return res.status(404).json({ ok: false, message: "Queue entry not found." });
      }

      const studentNumber = encodeURIComponent(queueEntry.student_number);

      const [studentResponse, facultyResponse] = await Promise.all([
        supabaseFetch<StudentRow>(
          `students?select=full_name,email,student_email&student_number=eq.${studentNumber}&limit=1`
        ),
        supabaseFetch<FacultyRow>(
          `faculty?select=id,name&id=eq.${queueEntry.faculty_id}&limit=1`
        ),
      ]);

      let studentLookupWarning: string | null = null;
      if (studentResponse.error) {
        studentLookupWarning = `Unable to read student email: ${studentResponse.error.message || "unknown error"}`;
      }

      const student = studentResponse.error ? null : (studentResponse.data?.[0] || null);
      const faculty = facultyResponse.data?.[0] || null;

      let sharedMeetLink = "";
      if (queueEntry.consultation_type === "google_meet") {
        const meetLinkResponse = await supabaseFetch<{ notes?: string | null }>(
          `queue_history?select=notes&queue_entry_id=eq.${queueId}&action=eq.google_meet_link_shared&order=created_at.desc&limit=1`
        );

        sharedMeetLink = String(meetLinkResponse.data?.[0]?.notes || "").trim();

        if (!sharedMeetLink) {
          sharedMeetLink = createRandomGoogleMeetLink();
          await insertQueueHistory(queueId, "google_meet_link_shared", sharedMeetLink);
        }
      }

      const emailMarkerResponse = await supabaseFetch<{ id: string }>(
        `queue_history?select=id&queue_entry_id=eq.${queueId}&action=eq.booking_email_sent&limit=1`
      );

      if ((emailMarkerResponse.data || []).length > 0) {
        return res.status(200).json({ ok: true, deduped: true, message: "Booking email already sent." });
      }

      const recipientEmail = resolveStudentEmail(student) || fallbackEmail;
      if (!recipientEmail) {
        return res.status(200).json({
          ok: false,
          skipped: true,
          message: studentLookupWarning || "No student email found for this booking.",
        });
      }

      const studentName = resolveStudentName(student, queueEntry.student_number);
      const subject = "EARIST Booking Confirmation";
      const bookingDate = new Date(queueEntry.created_at).toLocaleString("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      });

      const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
        <h2 style="margin: 0 0 12px;">Consultation Booking Confirmed</h2>
        <p>Hello ${studentName},</p>
        <p>Your consultation booking has been received.</p>
        <ul>
          <li><strong>Ticket ID:</strong> ${queueEntry.id}</li>
          <li><strong>Professor:</strong> ${faculty?.name || "TBA"}</li>
          <li><strong>Method:</strong> ${queueEntry.consultation_type.replace(/_/g, " ")}</li>
          ${queueEntry.consultation_type === "google_meet" && sharedMeetLink
            ? `<li><strong>Google Meet:</strong> <a href="${sharedMeetLink}">${sharedMeetLink}</a></li>`
            : ""}
          <li><strong>Booked At:</strong> ${bookingDate}</li>
        </ul>
        <p>You can track your status here:</p>
        <p><a href="${req.protocol}://${req.get("host")}/status/${queueEntry.id}">${req.protocol}://${req.get("host")}/status/${queueEntry.id}</a></p>
      </div>
    `;

      const emailResult = await sendBookingEmail(recipientEmail, subject, html);

      if (!emailResult.ok) {
        return res.status(200).json({
          ok: false,
          skipped: true,
          message: emailResult.message || "Email provider not configured or rejected request.",
        });
      }

      await insertQueueHistory(queueId, "booking_email_sent", `Delivered to ${recipientEmail}`);

      return res.status(200).json({ ok: true, recipient: recipientEmail, warning: studentLookupWarning || undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      return res.status(500).json({ ok: false, message: `Server email error: ${message}` });
    }
  });
}
