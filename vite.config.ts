import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

function vitePluginBookingEmailApi(
  smtpHost: string,
  smtpPortRaw: string,
  smtpUser: string,
  smtpPass: string,
  bookingEmailFrom: string,
  supabaseUrl: string,
  supabaseRestKey: string,
): Plugin {
  return {
    name: "booking-email-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/booking/email", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", async () => {
          try {
            const payload = JSON.parse(body || "{}") as {
              queueId?: string;
              studentEmail?: string;
            };

            const queueId = String(payload.queueId || "").trim();
            const recipient = String(payload.studentEmail || "").trim().toLowerCase();
            const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);

            if (!queueId) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, message: "Invalid queueId." }));
              return;
            }

            if (!isValidEmail) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, skipped: true, message: "No valid student email found for this booking." }));
              return;
            }

            if (!smtpHost || !smtpPortRaw || !smtpUser || !smtpPass) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, skipped: true, message: "SMTP credentials are not configured." }));
              return;
            }

            const smtpPort = Number(smtpPortRaw);
            if (!Number.isFinite(smtpPort) || smtpPort <= 0) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, skipped: true, message: "SMTP port is invalid." }));
              return;
            }

            const moduleName = "nodemailer";
            const nodemailerModule = await import(moduleName).catch(() => null);
            if (!nodemailerModule) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, skipped: true, message: "Nodemailer is not installed. Run npm install nodemailer." }));
              return;
            }

            const nodemailer = (nodemailerModule as any).default || nodemailerModule;

            const subject = "EARIST Booking Confirmation";
            const statusUrl = `${req.headers.origin || "http://localhost:5173"}/status/${queueId}`;
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(statusUrl)}`;

            const consultationTypeLabels: Record<string, string> = {
              face_to_face: "Face-to-Face",
              google_meet: "Google Meet",
            };

            let consultationMode = "Not specified";
            let professorName = "To be announced";
            let meetingLinkForTicket = "";
            let bookedDate = new Date().toLocaleDateString("en-PH", {
              year: "numeric",
              month: "long",
              day: "numeric",
            });
            let bookedTime = new Date().toLocaleTimeString("en-PH", {
              hour: "2-digit",
              minute: "2-digit",
            });

            if (supabaseUrl && supabaseRestKey) {
              const restHeaders = {
                apikey: supabaseRestKey,
                Authorization: `Bearer ${supabaseRestKey}`,
                Accept: "application/json",
                "Content-Type": "application/json",
              };

              // Deduplicate: only send one booking email per ticket.
              const markerUrl = `${supabaseUrl}/rest/v1/queue_history?select=id&queue_entry_id=eq.${queueId}&action=eq.booking_email_sent&limit=1`;
              const markerResponse = await fetch(markerUrl, { headers: restHeaders }).catch(() => null);
              if (markerResponse && markerResponse.ok) {
                const markerRows = (await markerResponse.json().catch(() => [])) as Array<{ id?: string }>;
                if (markerRows.length > 0) {
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ ok: true, deduped: true, message: "Booking email already sent." }));
                  return;
                }
              }

              const queueUrl = `${supabaseUrl}/rest/v1/queue_entries?select=id,faculty_id,consultation_type,created_at&id=eq.${queueId}&limit=1`;

              const queueResponse = await fetch(queueUrl, {
                headers: restHeaders,
              }).catch(() => null);

              if (queueResponse && queueResponse.ok) {
                const queueRows = (await queueResponse.json().catch(() => [])) as Array<{
                  faculty_id?: string;
                  consultation_type?: string;
                  created_at?: string;
                }>;

                const queueRow = queueRows[0];

                if (queueRow?.consultation_type) {
                  consultationMode =
                    consultationTypeLabels[queueRow.consultation_type] || queueRow.consultation_type.replace(/_/g, " ");
                }

                if (queueRow?.created_at) {
                  const bookedAt = new Date(queueRow.created_at);
                  if (!Number.isNaN(bookedAt.getTime())) {
                    bookedDate = bookedAt.toLocaleDateString("en-PH", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    });
                    bookedTime = bookedAt.toLocaleTimeString("en-PH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  }
                }

                if (queueRow?.faculty_id) {
                  const facultyUrl = `${supabaseUrl}/rest/v1/faculty?select=name,schedule&id=eq.${queueRow.faculty_id}&limit=1`;
                  const facultyResponse = await fetch(facultyUrl, {
                    headers: restHeaders,
                  }).catch(() => null);

                  if (facultyResponse && facultyResponse.ok) {
                    const facultyRows = (await facultyResponse.json().catch(() => [])) as Array<{ name?: string; schedule?: string | null }>;
                    if (facultyRows[0]?.name) {
                      professorName = facultyRows[0].name;
                    }

                    const scheduleRaw = String(facultyRows[0]?.schedule || "").trim();
                    if (scheduleRaw) {
                      try {
                        const parsed = JSON.parse(scheduleRaw) as { meetingLink?: string };
                        meetingLinkForTicket = String(parsed.meetingLink || "").trim();
                      } catch {
                        meetingLinkForTicket = "";
                      }
                    }
                  }
                }

                if (queueRow?.consultation_type === "google_meet" && meetingLinkForTicket) {
                  // Make Meet link available to faculty per ticket without searching.
                  const existingMeetLinkUrl = `${supabaseUrl}/rest/v1/queue_history?select=id&queue_entry_id=eq.${queueId}&action=eq.google_meet_link_shared&limit=1`;
                  const existingMeetLinkResponse = await fetch(existingMeetLinkUrl, { headers: restHeaders }).catch(() => null);
                  const existingMeetRows =
                    existingMeetLinkResponse && existingMeetLinkResponse.ok
                      ? ((await existingMeetLinkResponse.json().catch(() => [])) as Array<{ id?: string }>)
                      : [];

                  if (existingMeetRows.length === 0) {
                    const insertMeetLinkUrl = `${supabaseUrl}/rest/v1/queue_history`;
                    await fetch(insertMeetLinkUrl, {
                      method: "POST",
                      headers: {
                        ...restHeaders,
                        Prefer: "return=minimal",
                      },
                      body: JSON.stringify([
                        {
                          queue_entry_id: queueId,
                          action: "google_meet_link_shared",
                          notes: meetingLinkForTicket,
                        },
                      ]),
                    }).catch(() => null);
                  }
                }
              }
            }

            const html = `
              <div style="margin:0;padding:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f9;padding:24px 0;">
                  <tr>
                    <td align="center">
                      <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
                        <tr>
                          <td style="background:#10367D;padding:28px 32px;color:#ffffff;">
                            <h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:800;">Consultation Confirmed</h1>
                            <p style="margin:8px 0 0;font-size:14px;opacity:0.9;">EARIST Queue System Booking Receipt</p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:28px 32px 8px;">
                            <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Your consultation booking has been successfully recorded. Keep this ticket and present your QR code for quick status tracking.</p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
                              <tr>
                                <td style="padding:12px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;width:44%;">Ticket ID</td>
                                <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#0f172a;">${queueId}</td>
                              </tr>
                              <tr>
                                <td style="padding:12px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;">Professor</td>
                                <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#0f172a;">${professorName}</td>
                              </tr>
                              <tr>
                                <td style="padding:12px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;">Consultation Mode</td>
                                <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#0f172a;">${consultationMode}</td>
                              </tr>
                              ${consultationMode.toLowerCase().includes("google meet") && meetingLinkForTicket
                                ? `<tr>
                                <td style="padding:12px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;">Google Meet Link</td>
                                <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#0f172a;word-break:break-all;"><a href="${meetingLinkForTicket}" style="color:#10367D;text-decoration:underline;">${meetingLinkForTicket}</a></td>
                              </tr>`
                                : ""}
                              <tr>
                                <td style="padding:12px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;">Date Booked</td>
                                <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#0f172a;">${bookedDate}</td>
                              </tr>
                              <tr>
                                <td style="padding:12px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;">Time Booked</td>
                                <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#0f172a;">${bookedTime}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:20px 32px 6px;" align="center">
                            <img src="${qrImageUrl}" alt="Ticket QR Code" width="220" height="220" style="display:block;border:8px solid #f8fafc;border-radius:14px;" />
                            <p style="margin:12px 0 0;font-size:12px;color:#64748b;">Scan this QR to open your live ticket status</p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:14px 32px 28px;" align="center">
                            <a href="${statusUrl}" style="display:inline-block;background:#10367D;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;">Track Live Status</a>
                            <p style="margin:14px 0 0;font-size:12px;color:#64748b;word-break:break-all;">${statusUrl}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>
            `;

            const transporter = nodemailer.createTransport({
              host: smtpHost,
              port: smtpPort,
              secure: smtpPort === 465,
              auth: {
                user: smtpUser,
                pass: smtpPass,
              },
            });

            try {
              await transporter.sendMail({
                from: bookingEmailFrom || smtpUser,
                to: recipient,
                subject,
                html,
              });

              if (supabaseUrl && supabaseRestKey) {
                const restHeaders = {
                  apikey: supabaseRestKey,
                  Authorization: `Bearer ${supabaseRestKey}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                  Prefer: "return=minimal",
                };

                // Mark successful send so this ticket gets only one email.
                await fetch(`${supabaseUrl}/rest/v1/queue_history`, {
                  method: "POST",
                  headers: restHeaders,
                  body: JSON.stringify([
                    {
                      queue_entry_id: queueId,
                      action: "booking_email_sent",
                      notes: `Sent to ${recipient}`,
                    },
                  ]),
                }).catch(() => null);
              }
            } catch (smtpError) {
              const smtpMessage = smtpError instanceof Error ? smtpError.message : "SMTP send failed.";
              const normalized = smtpMessage.toLowerCase();
              const isGmailAuthFailure =
                normalized.includes("535") &&
                (normalized.includes("username and password not accepted") || normalized.includes("badcredentials"));

              const finalMessage = isGmailAuthFailure
                ? "SMTP error: Gmail rejected login. Enable 2-Step Verification and use a Google App Password in SMTP_PASS."
                : `SMTP error: ${smtpMessage}`;

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, skipped: true, message: finalMessage }));
              return;
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, recipient }));
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown server error";
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, message: `Server email error: ${message}` }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, path.resolve(import.meta.dirname), "");

  const plugins = [
    react(),
    tailwindcss(),
    jsxLocPlugin(),
    vitePluginManusRuntime(),
    vitePluginManusDebugCollector(),
    vitePluginBookingEmailApi(
      loadedEnv.SMTP_HOST || "",
      loadedEnv.SMTP_PORT || "",
      loadedEnv.SMTP_USER || "",
      loadedEnv.SMTP_PASS || "",
      loadedEnv.BOOKING_EMAIL_FROM || "",
      loadedEnv.VITE_SUPABASE_URL || loadedEnv.NEXT_PUBLIC_SUPABASE_URL || "",
      loadedEnv.SUPABASE_SERVICE_ROLE_KEY || loadedEnv.VITE_SUPABASE_ANON_KEY || loadedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    ),
  ];

  return {
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2018",
    cssTarget: "chrome61",
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
};
});
