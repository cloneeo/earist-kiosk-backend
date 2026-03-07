import type { Express } from "express";
import { storagePut } from "../storage";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseRestKey = supabaseServiceRoleKey || supabaseAnonKey;
const hasSupabaseConfig = !!supabaseUrl && !!supabaseRestKey;

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeBase64 = (value: string) => {
  const trimmed = value.trim();
  const marker = ",";
  if (trimmed.includes(";base64") && trimmed.includes(marker)) {
    return trimmed.slice(trimmed.indexOf(marker) + 1);
  }
  return trimmed;
};

const guessExt = (mimeType: string) => {
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/webm;codecs=opus": "webm",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
  };

  return map[mimeType.toLowerCase()] || "webm";
};

async function saveMetadata(params: {
  queueEntryId: string;
  fileKey: string;
  fileUrl: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
}) {
  const payload = [{
    queue_entry_id: params.queueEntryId,
    file_key: params.fileKey,
    file_url: params.fileUrl,
    mime_type: params.mimeType,
    size_bytes: params.sizeBytes,
    duration_seconds: params.durationSeconds,
  }];

  const response = await fetch(`${supabaseUrl}/rest/v1/consultation_recordings`, {
    method: "POST",
    headers: {
      apikey: supabaseRestKey,
      Authorization: `Bearer ${supabaseRestKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      message: detail || `Metadata save failed (${response.status})`,
    };
  }

  return { ok: true };
}

export function registerConsultationRecordingRoutes(app: Express) {
  app.post("/api/consultations/recording", async (req, res) => {
    try {
      const queueEntryId = String(req.body?.queueEntryId || "").trim();
      const mimeType = String(req.body?.mimeType || "audio/webm").trim() || "audio/webm";
      const durationSecondsRaw = Number(req.body?.durationSeconds ?? 0);
      const durationSeconds = Number.isFinite(durationSecondsRaw) && durationSecondsRaw > 0
        ? Math.round(durationSecondsRaw)
        : null;
      const base64DataRaw = String(req.body?.base64Data || "");

      if (!queueEntryId || !isUuid(queueEntryId)) {
        return res.status(400).json({ ok: false, message: "Invalid queueEntryId." });
      }

      if (!base64DataRaw.trim()) {
        return res.status(400).json({ ok: false, message: "Missing base64Data." });
      }

      const normalizedBase64 = normalizeBase64(base64DataRaw);
      const audioBuffer = Buffer.from(normalizedBase64, "base64");

      if (!audioBuffer.length) {
        return res.status(400).json({ ok: false, message: "Audio payload is empty." });
      }

      const sizeLimitBytes = 25 * 1024 * 1024;
      if (audioBuffer.length > sizeLimitBytes) {
        return res.status(413).json({ ok: false, message: "Audio exceeds 25MB upload limit." });
      }

      const ext = guessExt(mimeType);
      const stamp = Date.now();
      const datePath = new Date().toISOString().slice(0, 10);
      const storageKey = `consultation-recordings/${datePath}/${queueEntryId}-${stamp}.${ext}`;

      const uploaded = await storagePut(storageKey, audioBuffer, mimeType);

      if (!hasSupabaseConfig) {
        return res.status(200).json({
          ok: true,
          stored: true,
          metadataSaved: false,
          key: uploaded.key,
          url: uploaded.url,
          warning: "Supabase config missing. Recording uploaded without metadata.",
        });
      }

      const metadataResult = await saveMetadata({
        queueEntryId,
        fileKey: uploaded.key,
        fileUrl: uploaded.url,
        mimeType,
        sizeBytes: audioBuffer.length,
        durationSeconds,
      });

      return res.status(200).json({
        ok: true,
        stored: true,
        metadataSaved: metadataResult.ok,
        key: uploaded.key,
        url: uploaded.url,
        warning: metadataResult.ok ? undefined : metadataResult.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      return res.status(500).json({ ok: false, message: `Recording upload failed: ${message}` });
    }
  });
}
