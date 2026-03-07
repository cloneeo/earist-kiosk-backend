import type { Express } from "express";
import { storageDelete, storageGet, storagePut } from "../storage";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseRestKey = supabaseServiceRoleKey || supabaseAnonKey;
const hasSupabaseConfig = !!supabaseUrl && !!supabaseRestKey;

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

type RecordingRow = {
  id: string;
  queue_entry_id: string;
  file_key: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number | null;
  created_at: string;
  queue_entries?: {
    faculty_id?: string | null;
    student_number?: string | null;
  } | null;
};

type SupabaseListResponse<T> = {
  data: T[] | null;
  error?: { message?: string } | null;
};

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

const retentionCutoffIso = () => new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

async function cleanupExpiredRecordings() {
  if (!hasSupabaseConfig) return;

  const expired = await supabaseFetch<Pick<RecordingRow, "id" | "file_key">>(
    `consultation_recordings?select=id,file_key&created_at=lt.${retentionCutoffIso()}&limit=100`
  );

  const rows = expired.data || [];
  if (rows.length === 0) return;

  const deletedIds: string[] = [];

  for (const row of rows) {
    try {
      await storageDelete(row.file_key);
      deletedIds.push(row.id);
    } catch {
      // Keep metadata if storage deletion fails so we can retry later.
    }
  }

  if (deletedIds.length === 0) return;

  const inClause = `(${deletedIds.join(",")})`;
  await fetch(`${supabaseUrl}/rest/v1/consultation_recordings?id=in.${encodeURIComponent(inClause)}`, {
    method: "DELETE",
    headers: {
      apikey: supabaseRestKey,
      Authorization: `Bearer ${supabaseRestKey}`,
      Prefer: "return=minimal",
    },
  }).catch(() => null);
}

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
      await cleanupExpiredRecordings();

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

      if (!hasSupabaseConfig) {
        return res.status(500).json({ ok: false, message: "Supabase config missing for recording metadata." });
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

  app.get("/api/consultations/recordings", async (req, res) => {
    try {
      await cleanupExpiredRecordings();

      if (!hasSupabaseConfig) {
        return res.status(500).json({ ok: false, message: "Supabase config missing." });
      }

      const scope = String(req.query.scope || "faculty").trim();
      const facultyId = String(req.query.facultyId || "").trim();

      let path = "consultation_recordings?select=id,queue_entry_id,file_key,mime_type,size_bytes,duration_seconds,created_at,queue_entries!inner(faculty_id,student_number)&order=created_at.desc&limit=100";

      if (scope === "faculty") {
        if (!isUuid(facultyId)) {
          return res.status(400).json({ ok: false, message: "Invalid facultyId." });
        }
        path = `consultation_recordings?select=id,queue_entry_id,file_key,mime_type,size_bytes,duration_seconds,created_at,queue_entries!inner(faculty_id,student_number)&queue_entries.faculty_id=eq.${facultyId}&order=created_at.desc&limit=100`;
      }

      const recordingsResponse = await supabaseFetch<RecordingRow>(path);
      if (recordingsResponse.error) {
        return res.status(500).json({ ok: false, message: recordingsResponse.error.message || "Unable to read recordings." });
      }

      const rows = recordingsResponse.data || [];
      const hydrated = await Promise.all(
        rows.map(async (row) => {
          const signed = await storageGet(row.file_key).catch(() => null);
          return {
            id: row.id,
            queueEntryId: row.queue_entry_id,
            facultyId: row.queue_entries?.faculty_id || null,
            studentNumber: row.queue_entries?.student_number || "Unknown",
            mimeType: row.mime_type,
            sizeBytes: Number(row.size_bytes || 0),
            durationSeconds: row.duration_seconds || null,
            createdAt: row.created_at,
            audioUrl: signed?.url || "",
          };
        })
      );

      return res.status(200).json({ ok: true, recordings: hydrated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      return res.status(500).json({ ok: false, message: `Unable to load recordings: ${message}` });
    }
  });
}
