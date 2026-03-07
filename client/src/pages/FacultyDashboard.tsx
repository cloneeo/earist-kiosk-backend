import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { 
  LogOut, Users, Clock, 
  CheckCircle2, Play, SkipForward, User,
  Globe, UserCheck, Save, Edit3, Mic, Square
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { toast } from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { format, differenceInSeconds, addMinutes, parse } from "date-fns";
import { OnScreenKeyboard } from "@/components/OnScreenKeyboard";

type ConsultationType = "face_to_face" | "google_meet";
type SlotConfig = { time: string; method: ConsultationType };
type ParsedScheduleConfig = {
  dates: Date[];
  slots: SlotConfig[];
  meetingLink: string;
  officeLocation: string;
};

const normalizeDateOnly = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const parseScheduleConfig = (raw: unknown): ParsedScheduleConfig => {
  if (!raw) return { dates: [], slots: [{ time: "09:00", method: "face_to_face" }], meetingLink: "", officeLocation: "" };

  if (typeof raw === "object") {
    const parsed = raw as {
      mode?: string;
      dates?: string[];
      slots?: Array<{ time?: string; method?: ConsultationType }>;
      meetingLink?: string;
      officeLocation?: string;
    };

    if (parsed.mode === "slots_v1") {
      const dates = Array.isArray(parsed.dates)
        ? parsed.dates
            .map((item) => new Date(item))
            .filter((date) => !Number.isNaN(date.getTime()))
            .map(normalizeDateOnly)
        : [];

      const slots: SlotConfig[] = Array.isArray(parsed.slots)
        ? parsed.slots
            .map((slot): SlotConfig => ({
              time: String(slot.time || "").trim(),
              method: slot.method === "google_meet" ? "google_meet" : "face_to_face",
            }))
            .filter((slot) => /^\d{2}:\d{2}$/.test(slot.time))
            .slice(0, 5)
        : [];

      return {
        dates,
        slots: slots.length > 0 ? slots : [{ time: "09:00", method: "face_to_face" }],
        meetingLink: String(parsed.meetingLink || "").trim(),
        officeLocation: String(parsed.officeLocation || "").trim(),
      };
    }
  }

  const source = String(raw).trim();

  try {
    const parsed = JSON.parse(source) as {
      mode?: string;
      dates?: string[];
      slots?: Array<{ time?: string; method?: ConsultationType }>;
      meetingLink?: string;
      officeLocation?: string;
    };

    if (parsed.mode === "slots_v1") {
      const dates = Array.isArray(parsed.dates)
        ? parsed.dates
            .map((item) => new Date(item))
            .filter((date) => !Number.isNaN(date.getTime()))
            .map(normalizeDateOnly)
        : [];

      const slots: SlotConfig[] = Array.isArray(parsed.slots)
        ? parsed.slots
            .map((slot): SlotConfig => ({
              time: String(slot.time || "").trim(),
              method: slot.method === "google_meet" ? "google_meet" : "face_to_face",
            }))
            .filter((slot) => /^\d{2}:\d{2}$/.test(slot.time))
            .slice(0, 5)
        : [];

      return {
        dates,
        slots: slots.length > 0 ? slots : [{ time: "09:00", method: "face_to_face" }],
        meetingLink: String(parsed.meetingLink || "").trim(),
        officeLocation: String(parsed.officeLocation || "").trim(),
      };
    }
  } catch {
    // Keep backward compatibility for legacy plain-text schedules.
  }

  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  const dates = lines
    .map((line) => line.split("|")[0].trim())
    .map((dateText) => new Date(dateText))
    .filter((date) => !Number.isNaN(date.getTime()))
    .map(normalizeDateOnly);

  const timeMatch = lines[0]?.match(/(\d{1,2}:\d{2}\s?(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s?(?:AM|PM))/i);
  const parsedFallback = timeMatch ? parse(timeMatch[1].toUpperCase(), "h:mm a", new Date()) : null;
  const fallbackTime =
    parsedFallback && !Number.isNaN(parsedFallback.getTime())
      ? format(parsedFallback, "HH:mm")
      : "09:00";

  return { dates, slots: [{ time: fallbackTime, method: "face_to_face" }], meetingLink: "", officeLocation: "" };
};

const buildScheduleConfig = (dates: Date[], slots: SlotConfig[], meetingLink: string, officeLocation: string) => {
  return JSON.stringify({
    mode: "slots_v1",
    dates: dates.map((date) => format(date, "yyyy-MM-dd")),
    slots,
    meetingLink: meetingLink || undefined,
    officeLocation: officeLocation || undefined,
  });
};

export default function FacultyDashboard() {
  const [, setLocation] = useLocation();
  const { user, signOut, userRole } = useAuth();
  
  const [faculty, setFaculty] = useState<any | null>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [availableDates, setAvailableDates] = useState<Date[] | undefined>([]);
  const [slotOptions, setSlotOptions] = useState<SlotConfig[]>([{ time: "09:00", method: "face_to_face" }]);
  const [meetingLink, setMeetingLink] = useState("");
  const [officeLocation, setOfficeLocation] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardField, setKeyboardField] = useState<"meetingLink" | "officeLocation" | null>(null);
  const [activePanel, setActivePanel] = useState<"queue" | "recordings">("queue");
  const [recordings, setRecordings] = useState<Array<{
    id: string;
    queueEntryId: string;
    studentNumber: string;
    mimeType: string;
    sizeBytes: number;
    durationSeconds: number | null;
    createdAt: string;
    audioUrl: string;
  }>>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingRecording, setIsUploadingRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<"mic" | "meet_tab">("mic");
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const meetWatcherRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recordingQueueIdRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);

  const shouldUseOnScreenKeyboard =
    typeof window !== "undefined" &&
    !/android|iphone|ipad|ipod|mobile/i.test(window.navigator.userAgent || "") &&
    window.matchMedia("(pointer: coarse)").matches;

  const openKeyboardFor = (field: "meetingLink" | "officeLocation") => {
    if (!shouldUseOnScreenKeyboard) return;
    setKeyboardField(field);
    setKeyboardVisible(true);
  };

  const getKeyboardValue = () => {
    if (keyboardField === "meetingLink") return meetingLink;
    if (keyboardField === "officeLocation") return officeLocation;
    return "";
  };

  const updateKeyboardValue = (next: string) => {
    if (keyboardField === "meetingLink") setMeetingLink(next);
    if (keyboardField === "officeLocation") setOfficeLocation(next);
  };

  const stats = {
    waiting: queue.filter(t => t.status === 'waiting').length,
    inSession: queue.filter(t => t.status === 'called').length,
    total: queue.length
  };

  useEffect(() => {
    if (userRole && userRole !== "faculty" && userRole !== "admin") {
      setLocation("/");
    }
  }, [userRole, setLocation]);

  const formatSlotTime = (time: string) => {
    if (!/^\d{2}:\d{2}$/.test(time)) return time;
    return format(parse(time, "HH:mm", new Date()), "hh:mm a");
  };

  const loadData = async () => {
    try {
      if (!user) return;
      const { data: fac, error: facErr } = await supabase
        .from("faculty")
        .select("*, department:departments(*)")
        .eq("user_id", user.id)
        .single();

      if (facErr) throw facErr;
      setFaculty(fac);
      const parsedSchedule = parseScheduleConfig(fac.schedule);
      setAvailableDates(parsedSchedule.dates);
      setSlotOptions(parsedSchedule.slots);
      setMeetingLink(parsedSchedule.meetingLink);
      setOfficeLocation(parsedSchedule.officeLocation);
      await fetchQueue(fac.id);
      await loadRecordings(fac.id);
    } catch (err) {
      console.error("Failed to load data", err);
    } finally {
      setLoading(false);
    }
  };

  const loadRecordings = async (facultyId: string) => {
    if (!facultyId) return;
    setRecordingsLoading(true);
    try {
      const response = await fetch(`/api/consultations/recordings?scope=faculty&facultyId=${encodeURIComponent(facultyId)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || "Failed to load recordings.");
      }
      setRecordings(Array.isArray(payload.recordings) ? payload.recordings : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load recordings.";
      toast.error(message);
    } finally {
      setRecordingsLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    loadData();
  }, [user?.id]);

  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(() => {
      setLoading(false);
      console.warn("Faculty dashboard load timed out. Showing page shell.");
    }, 8000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [loading]);

  useEffect(() => {
    if (!faculty?.id) return;

    const subscription = supabase
      .channel(`faculty-updates:${faculty.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_entries",
          filter: `faculty_id=eq.${faculty.id}`,
        },
        () => fetchQueue(faculty.id),
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [faculty?.id]);

  useEffect(() => {
    if (!faculty?.id) return;
    const interval = window.setInterval(() => {
      void loadRecordings(faculty.id);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [faculty?.id]);

  const fetchQueue = async (facultyId: string) => {
    const { data } = await supabase
      .from("queue_entries")
      .select("*")
      .eq("faculty_id", facultyId)
      .in("status", ["waiting", "called"])
      .order("created_at", { ascending: true });

    if (data) {
      const entryIds = data.map((entry) => entry.id);
      let concernByEntryId: Record<string, string> = {};
      let nameByEntryId: Record<string, string> = {};
      let slotByEntryId: Record<string, string> = {};
      let meetLinkByEntryId: Record<string, string> = {};

      if (entryIds.length > 0) {
        const { data: queueHistory } = await supabase
          .from("queue_history")
          .select("queue_entry_id, action, notes, created_at")
          .in("queue_entry_id", entryIds)
          .in("action", ["concern_submitted", "student_identified", "slot_selected", "google_meet_link_shared"])
          .order("created_at", { ascending: false });

        if (queueHistory) {
          queueHistory.forEach((row) => {
            if (!row.notes) return;
            if (row.action === "concern_submitted" && !concernByEntryId[row.queue_entry_id]) {
              concernByEntryId[row.queue_entry_id] = row.notes;
            }
            if (row.action === "student_identified" && !nameByEntryId[row.queue_entry_id]) {
              nameByEntryId[row.queue_entry_id] = row.notes;
            }
            if (row.action === "slot_selected" && !slotByEntryId[row.queue_entry_id]) {
              slotByEntryId[row.queue_entry_id] = row.notes;
            }
            if (row.action === "google_meet_link_shared" && !meetLinkByEntryId[row.queue_entry_id]) {
              meetLinkByEntryId[row.queue_entry_id] = row.notes;
            }
          });
        }
      }

      const normalizedStudentNumbers = Array.from(
        new Set(data.map((entry) => String(entry.student_number || "").trim().toUpperCase()).filter(Boolean)),
      );
      let nameByStudentNumber: Record<string, string> = {};

      if (normalizedStudentNumbers.length > 0) {
        const { data: studentRows } = await supabase
          .from("students")
          .select("*")
          .in("student_number", normalizedStudentNumbers);

        if (studentRows) {
          nameByStudentNumber = studentRows.reduce((acc, row) => {
            const key = String((row as any).student_number || "").trim().toUpperCase();
            const resolvedName =
              String((row as any).full_name || "").trim() ||
              String((row as any).student_name || "").trim() ||
              String((row as any).name || "").trim();

            if (key && resolvedName) {
              acc[key] = resolvedName;
            }
            return acc;
          }, {} as Record<string, string>);
        }
      }

      const queueWithConcerns = data.map((entry) => ({
        ...entry,
        concern: concernByEntryId[entry.id] || "",
        student_name:
          nameByEntryId[entry.id] ||
          nameByStudentNumber[String(entry.student_number || "").trim().toUpperCase()] ||
          "",
        selected_slot: slotByEntryId[entry.id] || "",
        meet_link: meetLinkByEntryId[entry.id] || "",
      }));

      setQueue(queueWithConcerns);
      const calling = queueWithConcerns.find(q => q.status === 'called');
      if (calling?.called_at) startTimer(calling.called_at);
      else stopTimer();
    }
  };

  const handleSaveSchedule = async () => {
    if (!faculty) return;

    const normalizedDates = (availableDates || [])
      .map((date) => normalizeDateOnly(date))
      .sort((a, b) => a.getTime() - b.getTime());
    const uniqueDates = Array.from(new Map(normalizedDates.map((date) => [date.toDateString(), date])).values());

    const cleanedSlots: SlotConfig[] = slotOptions
      .map((slot): SlotConfig => ({
        time: String(slot.time || "").trim(),
        method: slot.method === "google_meet" ? "google_meet" : "face_to_face",
      }))
      .filter((slot) => /^\d{2}:\d{2}$/.test(slot.time))
      .slice(0, 5);

    if (uniqueDates.length === 0) {
      toast.error("Please select at least one consultation date.");
      return;
    }
    if (cleanedSlots.length === 0) {
      toast.error("Please configure at least one valid consultation time slot.");
      return;
    }

    const schedulePayload = buildScheduleConfig(uniqueDates, cleanedSlots, meetingLink.trim(), officeLocation.trim());

    const { error: err } = await supabase
      .from("faculty")
      .update({ schedule: schedulePayload })
      .eq("id", faculty.id);

    if (!err) {
      setFaculty({ ...faculty, schedule: schedulePayload });
      setIsEditingSchedule(false);
      toast.success("Schedule Updated Successfully");
    }
  };

  const handleDateSelection = (dates: Date[] | undefined) => {
    const normalized = (dates || []).map((date) => normalizeDateOnly(date));
    const deduped = Array.from(new Map(normalized.map((date) => [date.toDateString(), date])).values()).sort((a, b) => a.getTime() - b.getTime());
    setAvailableDates(deduped);
  };

  const handleSlotTimeChange = (index: number, value: string) => {
    setSlotOptions((prev) => prev.map((slot, i) => (i === index ? { ...slot, time: value } : slot)));
  };

  const handleSlotMethodChange = (index: number, method: ConsultationType) => {
    setSlotOptions((prev) => prev.map((slot, i) => (i === index ? { ...slot, method } : slot)));
  };

  const handleAddSlot = () => {
    if (slotOptions.length >= 5) {
      toast.error("You can only set up to 5 time slots.");
      return;
    }
    setSlotOptions((prev) => [...prev, { time: "09:00", method: "face_to_face" }]);
  };

  const handleRemoveSlot = (index: number) => {
    setSlotOptions((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [{ time: "09:00", method: "face_to_face" }];
    });
  };

  const handleMethodChange = async (method: "face_to_face" | "online") => {
    if (!faculty) return;
    if (faculty.consultation_method === method) return;

    const { error: err } = await supabase
      .from("faculty")
      .update({ consultation_method: method })
      .eq("id", faculty.id);
    
    if (err) {
      toast.error("Failed to update consultation method");
      return;
    }

    setFaculty({ ...faculty, consultation_method: method });
    setSlotOptions((prev) =>
      prev.map((slot) => ({
        ...slot,
        method: method === "online" ? "google_meet" : "face_to_face",
      })),
    );
    toast.success(`Method updated to ${method.replace(/_/g, " ")}`);
  };

  const handleStatusChange = async (status: "accepting" | "on_break" | "offline") => {
    if (!faculty) return;
    const { error: err } = await supabase.from("faculty").update({ status }).eq("id", faculty.id);
    if (!err) setFaculty({ ...faculty, status });
  };

  const handleCallNext = async () => {
    const nextStudent = queue.find(q => q.status === 'waiting');
    if (!nextStudent) return;
    
    const { error } = await supabase
      .from("queue_entries")
      .update({ status: "called", called_at: new Date().toISOString() })
      .eq("id", nextStudent.id);
    
    if (!error) {
      const label = nextStudent.student_name
        ? `${nextStudent.student_name} (${nextStudent.student_number})`
        : nextStudent.student_number;
      toast.success(`Calling ${label}`);
    }
  };

  const handleComplete = async (id: string) => {
    if (isRecording && recordingQueueIdRef.current === id) {
      await handleStopRecording();
    }

    const { error } = await supabase
      .from("queue_entries")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    
    if (!error) toast.success("Session Completed");
  };

  const handleSkip = async (id: string) => {
    if (isRecording && recordingQueueIdRef.current === id) {
      await handleStopRecording();
    }

    const { error } = await supabase
      .from("queue_entries")
      .update({ status: "waiting", called_at: null })
      .eq("id", id);
    
    if (!error) toast("Student skipped and returned to queue", { icon: '⏭️' });
  };

  const clearMeetWatcher = () => {
    if (meetWatcherRef.current !== null) {
      window.clearInterval(meetWatcherRef.current);
      meetWatcherRef.current = null;
    }
  };

  const handleLaunchMeet = (queueEntry: any) => {
    if (!queueEntry || queueEntry.consultation_type !== "google_meet") return;

    const parsedSchedule = parseScheduleConfig(faculty?.schedule);
    const meetUrl = parsedSchedule.meetingLink || String(queueEntry.meet_link || "").trim() || "https://meet.google.com/new";
    const meetWindow = window.open(meetUrl, "_blank", "noopener,noreferrer");

    if (!meetWindow) {
      toast.error("Enable popups so the Google Meet link can open.");
      return;
    }

    toast.success("Google Meet opened. Session auto-completes when the Meet tab is closed.");
    clearMeetWatcher();

    let completed = false;
    meetWatcherRef.current = window.setInterval(async () => {
      if (completed) return;
      if (!meetWindow.closed) return;
      completed = true;
      clearMeetWatcher();
      await handleComplete(queueEntry.id);
    }, 2000);
  };

  useEffect(() => {
    return () => {
      clearMeetWatcher();
      try {
        recorderRef.current?.stop();
      } catch {
        // Ignore stop errors while unmounting.
      }
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const value = String(reader.result || "");
        const commaIndex = value.indexOf(",");
        resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
      };
      reader.onerror = () => reject(new Error("Failed to convert recording to base64."));
      reader.readAsDataURL(blob);
    });

  const uploadRecording = async (queueEntryId: string, blob: Blob, durationSeconds: number) => {
    setIsUploadingRecording(true);
    try {
      const base64Data = await blobToBase64(blob);
      const response = await fetch("/api/consultations/recording", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          queueEntryId,
          mimeType: blob.type || "audio/webm",
          base64Data,
          durationSeconds,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        toast.error(payload?.message || "Recording upload failed.");
        return;
      }

      if (payload?.metadataSaved === false && payload?.warning) {
        toast(payload.warning, { icon: "ℹ️" });
        return;
      }

      toast.success("Audio recording saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Recording upload failed: ${message}`);
    } finally {
      setIsUploadingRecording(false);
    }
  };

  const startRecorderWithStream = (queueEntryId: string, stream: MediaStream, successMessage: string) => {
    recorderStreamRef.current = stream;

    const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const mimeType = preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    recordingChunksRef.current = [];
    recordingStartedAtRef.current = Date.now();
    recordingQueueIdRef.current = queueEntryId;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const startedAt = recordingStartedAtRef.current || Date.now();
      const queueId = recordingQueueIdRef.current;
      const chunks = recordingChunksRef.current;

      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });

      recordingStartedAtRef.current = null;
      recordingQueueIdRef.current = null;
      recordingChunksRef.current = [];
      recorderRef.current = null;
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;

      if (queueId && blob.size > 0) {
        void uploadRecording(queueId, blob, durationSeconds);
      }
    };

    mediaRecorder.start(1000);
    recorderRef.current = mediaRecorder;
    setIsRecording(true);
    toast.success(successMessage);
  };

  const handleStartRecording = async (queueEntryId: string) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Audio recording is not supported on this device/browser.");
      return;
    }

    try {
      if (recordingMode === "meet_tab") {
        const getDisplayMedia = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
        if (!getDisplayMedia) {
          toast.error("Tab/system audio capture is not supported on this browser.");
          return;
        }

        const displayStream = await getDisplayMedia({ video: true, audio: true });
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
          displayStream.getTracks().forEach((track) => track.stop());
          toast.error("No tab/system audio track was shared. Re-share and enable audio.");
          return;
        }

        // Record only audio tracks from captured tab/system media.
        const audioOnlyStream = new MediaStream(audioTracks);
        startRecorderWithStream(queueEntryId, audioOnlyStream, "Meet tab audio recording started.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startRecorderWithStream(queueEntryId, stream, "Microphone recording started.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Unable to start recording: ${message}`);
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
    }
  };

  const handleStopRecording = async () => {
    if (!recorderRef.current || recorderRef.current.state === "inactive") {
      setIsRecording(false);
      return;
    }

    recorderRef.current.stop();
    setIsRecording(false);
    toast.success("Audio recording stopped.");
  };

  const startTimer = (calledAt: string) => {
    stopTimer();
    const endTime = addMinutes(new Date(calledAt), 15);
    const updateTimer = () => {
      const diff = differenceInSeconds(endTime, new Date());
      setTimeLeft(diff <= 0 ? 0 : diff);
    };
    updateTimer();
    timerRef.current = setInterval(updateTimer, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(null);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const currentCalling = queue.find(q => q.status === 'called');
  const pending = queue.filter(q => q.status === 'waiting');
  const parsedFacultySchedule = parseScheduleConfig(faculty?.schedule);
  const faceToFaceLocation = parsedFacultySchedule.officeLocation || "Faculty office";

  return (
    <div className={`min-h-screen bg-[#E8E6EB] flex flex-col font-sans ${keyboardVisible ? "pb-64 md:pb-72" : ""}`}>
      <nav className="bg-white border-b border-[#E8E6EB] px-8 py-4 flex justify-between items-center shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="bg-[#024059] p-2 rounded-lg text-white shadow-md"><Users className="w-5 h-5" /></div>
          <h1 className="text-xl font-extrabold text-[#024059] tracking-tight uppercase">Faculty Portal</h1>
        </div>
        <div className="flex items-center gap-6">
          <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest">Prof. {faculty?.name}</p>
          <button onClick={() => signOut()} className="text-[#024059]/65 hover:text-[#024059] font-black uppercase tracking-widest text-[10px] flex items-center gap-2">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto w-full p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1 space-y-6">
          {/* SCHEDULE EDITOR */}
          <Card className="border-0 shadow-sm rounded-3xl bg-white overflow-hidden border-b-4 border-[#E8E6EB]">
            <CardHeader className="bg-slate-50 border-b border-slate-100 py-4 flex flex-row justify-between items-center">
              <CardTitle className="text-[10px] font-black uppercase text-[#024059]/65 tracking-widest">My Schedule</CardTitle>
              <button onClick={() => setIsEditingSchedule(!isEditingSchedule)} className="text-[#024059] hover:scale-110 transition-transform">
                <Edit3 size={14} />
              </button>
            </CardHeader>
            <CardContent className="p-4">
              {isEditingSchedule ? (
                <div className="space-y-3">
                  <Calendar
                    mode="multiple"
                    selected={availableDates}
                    onSelect={handleDateSelection}
                    disabled={{ before: today }}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-2"
                  />
                  <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest px-1">
                    {availableDates && availableDates.length > 0 ? `${availableDates.length} date(s) selected` : "Select one or more available consultation dates"}
                  </p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest">
                        Time Slots (Max 5)
                      </label>
                      <Button
                        type="button"
                        onClick={handleAddSlot}
                        variant="outline"
                        className="h-8 px-3 text-[10px] font-black uppercase rounded-lg"
                      >
                        Add Slot
                      </Button>
                    </div>
                    {slotOptions.map((slot, index) => (
                      <div key={`${index}-${slot.time}`} className="grid grid-cols-[1fr,1fr,auto] gap-2 items-center">
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(e) => handleSlotTimeChange(index, e.target.value)}
                          className="w-full h-10 px-3 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E8E6EB]"
                        />
                        <select
                          value={slot.method}
                          onChange={(e) =>
                            handleSlotMethodChange(index, e.target.value === "google_meet" ? "google_meet" : "face_to_face")
                          }
                          className="w-full h-10 px-3 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E8E6EB] uppercase"
                        >
                          <option value="face_to_face">Face to Face</option>
                          <option value="google_meet">Google Meet</option>
                        </select>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-10 px-3 text-[10px] font-black uppercase text-slate-500"
                          onClick={() => handleRemoveSlot(index)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest">Google Meet Link</label>
                    <input
                      type="url"
                      value={meetingLink}
                      onChange={(e) => setMeetingLink(e.target.value)}
                      onFocus={() => openKeyboardFor("meetingLink")}
                      placeholder="https://meet.google.com/..."
                      className="w-full h-10 px-3 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E8E6EB]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest">Office / Room (for F2F)</label>
                    <input
                      type="text"
                      value={officeLocation}
                      onChange={(e) => setOfficeLocation(e.target.value)}
                      onFocus={() => openKeyboardFor("officeLocation")}
                      placeholder="e.g. CE Dept Room 204"
                      className="w-full h-10 px-3 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E8E6EB]"
                    />
                  </div>

                  <Button onClick={handleSaveSchedule} className="w-full bg-[#024059] text-white rounded-xl h-10 text-[10px] font-black uppercase">
                    <Save size={14} className="mr-2" /> Save Schedule
                  </Button>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mb-2">
                    Dates
                  </p>
                  <p className="text-xs font-bold text-slate-700 leading-relaxed">
                    {parsedFacultySchedule.dates.length > 0
                      ? parsedFacultySchedule.dates.map((date) => format(date, "MMM d, yyyy")).join(" • ")
                      : "No dates set yet."}
                  </p>

                  <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mt-3 mb-2">
                    Time Slots
                  </p>
                  <div className="space-y-1">
                    {parsedFacultySchedule.slots.slice(0, 5).map((slot, index) => (
                      <p key={`${slot.time}-${index}`} className="text-xs font-bold text-slate-700">
                        {formatSlotTime(slot.time)} • {slot.method === "google_meet" ? "Google Meet" : "Face to Face"}
                      </p>
                    ))}
                  </div>
                  {parsedFacultySchedule.meetingLink && (
                    <p className="text-[10px] font-bold text-[#024059] mt-3 break-all">
                      Meet Link: {parsedFacultySchedule.meetingLink}
                    </p>
                  )}
                  {parsedFacultySchedule.officeLocation && (
                    <p className="text-[10px] font-bold text-slate-600 mt-2">
                      Office: {parsedFacultySchedule.officeLocation}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-3xl bg-white overflow-hidden">
            <CardHeader className="bg-slate-50 border-b border-slate-100 py-4">
              <CardTitle className="text-[10px] font-black uppercase text-[#024059]/65">Default Consultation Method</CardTitle>
            </CardHeader>
            <CardContent className="p-4 flex gap-2">
              <Button 
                variant={faculty?.consultation_method === 'face_to_face' ? 'default' : 'outline'}
                className={`flex-1 rounded-xl h-12 text-[10px] font-black uppercase tracking-widest ${faculty?.consultation_method === 'face_to_face' ? 'bg-[#024059] text-white border-0' : 'text-[#024059]/65'}`}
                onClick={() => handleMethodChange('face_to_face')}
              >
                <UserCheck size={14} className="mr-2" /> F2F
              </Button>
              <Button 
                variant={faculty?.consultation_method === 'online' ? 'default' : 'outline'}
                className={`flex-1 rounded-xl h-12 text-[10px] font-black uppercase tracking-widest ${faculty?.consultation_method === 'online' ? 'bg-[#024059] text-white border-0' : 'text-[#024059]/65'}`}
                onClick={() => handleMethodChange('online')}
              >
                <Globe size={14} className="mr-2" /> Online
              </Button>
            </CardContent>
            <div className="px-4 pb-4">
              <p className="text-[10px] font-bold text-[#024059]/65 uppercase tracking-widest">
                Quick action: applies this method to all current schedule slots.
              </p>
            </div>
          </Card>

          <Card className="border-0 shadow-sm rounded-3xl bg-white overflow-hidden">
            <CardHeader className="bg-slate-50 border-b border-slate-100 py-4">
              <CardTitle className="text-[10px] font-black uppercase text-[#024059]/65">Availability</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              {['accepting', 'on_break', 'offline'].map((s) => (
                <Button 
                  key={s} 
                  variant={faculty?.status === s ? 'default' : 'ghost'} 
                  className={`w-full justify-start rounded-xl capitalize font-bold ${faculty?.status === s ? 'bg-[#024059] text-white' : 'text-slate-500'}`}
                  onClick={() => handleStatusChange(s as any)}
                >
                  <div className={`w-2 h-2 rounded-full mr-3 ${s === 'accepting' ? 'bg-[#E8E6EB]' : s === 'on_break' ? 'bg-[#E8E6EB]' : 'bg-slate-400'}`} />
                  {s.replace('_', ' ')}
                </Button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div className="bg-white p-6 rounded-[24px] shadow-sm border border-slate-100 flex flex-col">
              <span className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest">Waiting</span>
              <span className="text-3xl font-black text-[#024059]">{stats.waiting}</span>
            </div>
            <div className="bg-[#024059] p-6 rounded-[24px] shadow-lg flex flex-col text-white">
              <span className="text-[10px] font-black opacity-60 uppercase tracking-widest">My Total Today</span>
              <span className="text-3xl font-black">{stats.total}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-8">
          <div className="flex items-center justify-end">
            <div className="flex gap-2 bg-white p-1 rounded-xl border border-slate-100">
              <Button
                variant={activePanel === "queue" ? "default" : "ghost"}
                className={activePanel === "queue" ? "bg-[#024059] text-white rounded-lg h-8 px-4 text-[10px] font-black uppercase" : "rounded-lg h-8 px-4 text-[10px] font-black uppercase text-slate-500"}
                onClick={() => setActivePanel("queue")}
              >
                Queue
              </Button>
              <Button
                variant={activePanel === "recordings" ? "default" : "ghost"}
                className={activePanel === "recordings" ? "bg-[#024059] text-white rounded-lg h-8 px-4 text-[10px] font-black uppercase" : "rounded-lg h-8 px-4 text-[10px] font-black uppercase text-slate-500"}
                onClick={() => {
                  setActivePanel("recordings");
                  if (faculty?.id) void loadRecordings(faculty.id);
                }}
              >
                Recordings
              </Button>
            </div>
          </div>

          {activePanel === "recordings" ? (
            <Card className="border-0 shadow-sm rounded-[32px] bg-white overflow-hidden">
              <CardHeader className="bg-slate-50 px-8 py-6 border-b border-slate-100 flex flex-row justify-between items-center">
                <CardTitle className="text-slate-800 font-black uppercase tracking-widest text-xs">Recent Recordings (48h)</CardTitle>
                <Badge className="bg-slate-200 text-slate-600 font-black px-3 py-1 rounded-lg text-[10px]">{recordings.length}</Badge>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {recordingsLoading && <p className="text-xs font-bold text-slate-500">Loading recordings...</p>}
                {!recordingsLoading && recordings.length === 0 && (
                  <p className="text-xs font-bold text-slate-500">No recordings available. Items older than 48 hours are auto-deleted.</p>
                )}
                {!recordingsLoading && recordings.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-black text-slate-800">{item.studentNumber}</p>
                        <p className="text-[10px] font-bold text-[#024059]/65 uppercase tracking-widest">
                          {new Date(item.createdAt).toLocaleString()} • {item.durationSeconds ? `${item.durationSeconds}s` : "Duration N/A"}
                        </p>
                      </div>
                      <Badge className="bg-white text-[#024059] border border-[#E8E6EB] font-black text-[10px]">
                        {(item.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                      </Badge>
                    </div>
                    {item.audioUrl ? (
                      <audio controls className="w-full" src={item.audioUrl} preload="none" />
                    ) : (
                      <p className="text-xs font-bold text-slate-500">Audio link unavailable.</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <>
          <div className="relative">
            <div className="absolute -top-4 left-6 right-6 bg-[#024059] rounded-t-[40px] h-24 shadow-inner opacity-40"></div>
            <Card className="relative z-10 border-0 shadow-2xl rounded-[40px] bg-white overflow-hidden min-h-[450px] flex flex-col">
              <CardHeader className="border-b border-slate-50 flex flex-row justify-between items-center px-10 py-8">
                <CardTitle className="text-xs font-black uppercase text-[#024059]/65 tracking-[0.2em]">Queue Monitor</CardTitle>
                {timeLeft !== null && <Badge className={`font-mono px-6 py-2 rounded-full text-xl shadow-inner ${timeLeft < 60 ? 'bg-[#024059] text-white animate-pulse' : 'bg-slate-50 text-slate-600 border border-slate-100'}`}>{formatTime(timeLeft)}</Badge>}
              </CardHeader>
              
              <CardContent className="flex-grow flex flex-col items-center justify-center p-10 text-center">
                <AnimatePresence mode="wait">
                  {currentCalling ? (
                    <motion.div key="active" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-10 w-full">
                      <div className="w-28 h-28 bg-[#E8E6EB]/60 text-[#024059] rounded-[40px] flex items-center justify-center mx-auto shadow-inner"><User size={56} /></div>
                      <div>
                        {currentCalling.student_name && (
                          <p className="text-xl font-black text-[#024059] tracking-wide">{currentCalling.student_name}</p>
                        )}
                        <h2 className="text-7xl font-black text-slate-900 tracking-tighter">{currentCalling.student_number}</h2>
                        <div className="flex items-center justify-center gap-2 mt-4">
                          <span className="text-[#024059]/65 font-bold uppercase tracking-widest text-[10px]">Method:</span>
                          {currentCalling.consultation_type === "google_meet" ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleLaunchMeet(currentCalling)}
                              className="h-8 px-4 rounded-lg border-[#E8E6EB] text-[#024059] font-black uppercase text-[10px]"
                            >
                              Open Google Meet
                            </Button>
                          ) : (
                            <Badge variant="outline" className="border-[#E8E6EB] text-[#024059] font-black px-3 py-1 rounded-lg uppercase text-[10px]">
                              Face To Face
                            </Badge>
                          )}
                        </div>
                        {currentCalling.consultation_type !== "google_meet" && (
                          <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mt-2">
                            Office: <span className="text-slate-700 normal-case tracking-normal">{faceToFaceLocation}</span>
                          </p>
                        )}
                        {currentCalling.selected_slot && (
                          <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mt-3">
                            Slot: <span className="text-slate-700 normal-case tracking-normal">{currentCalling.selected_slot}</span>
                          </p>
                        )}
                      </div>
                      {currentCalling.concern && (
                        <div className="max-w-2xl mx-auto text-left bg-slate-50 border border-slate-100 rounded-2xl p-5">
                          <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mb-2">Consultation Concern</p>
                          <p className="text-sm font-bold text-slate-700 leading-relaxed">{currentCalling.concern}</p>
                        </div>
                      )}
                      <div className="flex gap-4 pt-4 max-w-sm mx-auto w-full">
                        {currentCalling.consultation_type === "google_meet" && !isRecording && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-16 px-4 rounded-2xl border-[#E8E6EB] text-[#024059] font-black uppercase tracking-widest text-[10px]"
                            onClick={() => setRecordingMode((prev) => (prev === "meet_tab" ? "mic" : "meet_tab"))}
                            disabled={isUploadingRecording}
                          >
                            {recordingMode === "meet_tab" ? "Source: Meet Tab" : "Source: Mic"}
                          </Button>
                        )}
                        <Button
                          className={`flex-1 h-16 rounded-2xl border-0 font-black uppercase tracking-widest text-[10px] shadow-sm ${
                            isRecording ? "bg-[#024059] text-white hover:bg-[#024059]" : "bg-[#E8E6EB]/60 text-[#024059] hover:bg-[#E8E6EB]/70"
                          }`}
                          onClick={() => {
                            if (isRecording) {
                              void handleStopRecording();
                              return;
                            }
                            void handleStartRecording(currentCalling.id);
                          }}
                          disabled={isUploadingRecording}
                        >
                          {isRecording ? <Square size={14} className="mr-2" /> : <Mic size={14} className="mr-2" />}
                          {isRecording ? "Stop Rec" : recordingMode === "meet_tab" && currentCalling.consultation_type === "google_meet" ? "Record Meet" : "Record"}
                        </Button>
                        <Button className="flex-1 h-16 bg-[#E8E6EB]/60 text-[#024059] hover:bg-[#E8E6EB]/70 rounded-2xl border-0 font-black uppercase tracking-widest text-[10px] shadow-sm" onClick={() => handleComplete(currentCalling.id)}>
                          Complete
                        </Button>
                        <Button className="flex-1 h-16 bg-[#E8E6EB]/60 text-[#024059] hover:bg-[#E8E6EB]/70 rounded-2xl border-0 font-black uppercase tracking-widest text-[10px] shadow-sm" onClick={() => handleSkip(currentCalling.id)}>
                          Skip
                        </Button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto opacity-40"><Users size={32} className="text-[#024059]/55" /></div>
                      <p className="text-[#024059]/55 font-black uppercase tracking-[0.4em] text-xs">No active session</p>
                      <Button className="bg-[#024059] hover:bg-[#024059] text-white px-12 h-16 rounded-[24px] font-black text-lg shadow-xl shadow-[#024059]/20 uppercase tracking-widest flex items-center gap-3 transition-all active:scale-95" onClick={handleCallNext} disabled={pending.length === 0}>
                        <Play size={20} fill="currentColor" /> Call Next
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </div>

          <Card className="border-0 shadow-sm rounded-[32px] bg-white overflow-hidden">
             <CardHeader className="bg-slate-50 px-8 py-6 border-b border-slate-100 flex flex-row justify-between items-center">
                <CardTitle className="text-slate-800 font-black uppercase tracking-widest text-xs">Waiting Students</CardTitle>
                <Badge className="bg-slate-200 text-slate-600 font-black px-3 py-1 rounded-lg text-[10px]">{pending.length}</Badge>
             </CardHeader>
             <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {pending.map((s, i) => (
                  <div key={s.id} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-5 transition-all hover:border-[#E8E6EB] hover:bg-white group">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-black text-[#024059]/65 shadow-sm group-hover:text-[#024059] text-xs">{i + 1}</div>
                    <div className="flex-grow">
                      <p className="font-black text-[#024059] text-sm tracking-tight">{s.student_name || "Student"}</p>
                      <p className="font-black text-slate-800 text-lg tracking-tight">{s.student_number}</p>
                      <p className="text-[10px] font-bold text-[#024059]/65 uppercase tracking-widest mt-1 flex items-center gap-1.5"><Clock size={10} /> {format(new Date(s.created_at), 'hh:mm a')}</p>
                      {s.selected_slot && (
                        <p className="text-[10px] font-bold text-slate-500 mt-2">{s.selected_slot}</p>
                      )}
                      {s.concern && (
                        <p className="text-[11px] font-bold text-slate-600 mt-2 leading-relaxed">{s.concern}</p>
                      )}
                    </div>
                  </div>
                ))}
                {pending.length === 0 && <div className="col-span-2 py-16 text-center text-slate-200 font-black uppercase tracking-[0.5em] text-[10px]">No pending requests</div>}
             </CardContent>
          </Card>
            </>
          )}
        </div>
      </div>

      {keyboardVisible && keyboardField && isEditingSchedule && (
        <OnScreenKeyboard
          title="Schedule Keyboard"
          value={getKeyboardValue()}
          onChange={updateKeyboardValue}
          onEnter={() => setKeyboardVisible(false)}
          onClose={() => setKeyboardVisible(false)}
          mode={keyboardField === "meetingLink" ? "email" : "text"}
        />
      )}
    </div>
  );
}
