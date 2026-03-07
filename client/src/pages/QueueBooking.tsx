import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, ChevronLeft, Loader2, School, BookOpen, UserCircle, CheckCircle2, Clock, ChevronRight } from "lucide-react";
import { kioskSupabase } from "@/lib/supabaseKiosk";
import type { Database } from "@/lib/supabase";
import { buildApiUrl } from "@/lib/apiBase";
import { OnScreenKeyboard } from "@/components/OnScreenKeyboard";
import { clearPendingBookingEmail, enqueuePendingBookingEmail } from "@/lib/pendingBookingEmails";

type College = Database["public"]["Tables"]["colleges"]["Row"];
type Department = Database["public"]["Tables"]["departments"]["Row"];
type Faculty = Database["public"]["Tables"]["faculty"]["Row"];
type ConsultationType = "face_to_face" | "google_meet";
type SlotOption = {
  key: string;
  dateLabel: string;
  timeLabel: string;
  method: ConsultationType;
  sortKey: number;
};

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const randomMeetChunk = (length: number) => {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
};

const createRandomGoogleMeetLink = () =>
  `https://meet.google.com/${randomMeetChunk(3)}-${randomMeetChunk(4)}-${randomMeetChunk(3)}`;

export default function QueueBooking() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const studentNumber = params.get("student") || "";
  const studentName = params.get("name") || "";
  const studentEmail = params.get("email") || "";
  const bookingEmailUrl = buildApiUrl("/api/booking/email");

  const [step, setStep] = useState<"college" | "department" | "faculty" | "type">("college");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  const [colleges, setColleges] = useState<College[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [faculties, setFaculties] = useState<any[]>([]);

  const [selectedCollege, setSelectedCollege] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [selectedFaculty, setSelectedFaculty] = useState<string | null>(null);
  const [consultationConcern, setConsultationConcern] = useState("");
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [selectedConsultationMethod, setSelectedConsultationMethod] = useState<ConsultationType | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const shouldUseOnScreenKeyboard =
    typeof window !== "undefined" &&
    !/android|iphone|ipad|ipod|mobile/i.test(window.navigator.userAgent || "") &&
    window.matchMedia("(pointer: coarse)").matches;

  const maskStudentNumber = (studentId: string) => {
    const normalized = studentId.trim().toUpperCase();
    if (!normalized) return "";
    const parts = normalized.split("-");
    if (parts.length === 2) {
      const suffix = parts[1].slice(-1);
      return `${parts[0]}-*****${suffix}`;
    }
    return `${normalized.slice(0, 3)}*****${normalized.slice(-1)}`;
  };

  const parseSlotOptions = (facultyData: any): SlotOption[] => {
    const scheduleRaw = String(facultyData?.schedule || "").trim();
    const defaultMethod: ConsultationType =
      facultyData?.consultation_method === "online" ? "google_meet" : "face_to_face";

    if (!scheduleRaw) {
      return [
        {
          key: "default-slot",
          dateLabel: "Next Available",
          timeLabel: "As Soon As Possible",
          method: defaultMethod,
          sortKey: Number.MAX_SAFE_INTEGER,
        },
      ];
    }

    try {
      const parsed = JSON.parse(scheduleRaw) as {
        mode?: string;
        dates?: string[];
        slots?: Array<{ time?: string; method?: ConsultationType }>;
      };

      if (parsed.mode === "slots_v1" && Array.isArray(parsed.slots) && parsed.slots.length > 0) {
        const validSlots = parsed.slots
          .map((slot) => ({
            time: String(slot.time || "").trim(),
            method: slot.method === "google_meet" ? "google_meet" : "face_to_face",
          }))
          .filter((slot) => /^\d{2}:\d{2}$/.test(slot.time));

        const parsedDates = Array.isArray(parsed.dates)
          ? parsed.dates
              .map((rawDate) => new Date(rawDate))
              .filter((date) => !Number.isNaN(date.getTime()))
          : [];

        const sourceDates = parsedDates.length > 0 ? parsedDates : [new Date()];
        const nowTime = now.getTime();

        const options = sourceDates.flatMap((date) =>
          validSlots.map((slot) => {
            const [hours, mins] = slot.time.split(":").map(Number);
            const slotDate = new Date(date);
            slotDate.setHours(hours, mins, 0, 0);

            return {
              key: `${slotDate.toISOString()}-${slot.method}`,
              dateLabel: slotDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                weekday: "short",
              }),
              timeLabel: slotDate.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              }),
              method: slot.method,
              sortKey: slotDate.getTime(),
            } as SlotOption;
          }),
        );

        return options
          .filter((slot) => slot.sortKey >= nowTime - 5 * 60 * 1000)
          .sort((a, b) => a.sortKey - b.sortKey)
          .slice(0, 5);
      }
    } catch {
      // Fall back to default option for non-JSON legacy schedules.
    }

    return [
      {
        key: "default-slot",
        dateLabel: "Next Available",
        timeLabel: "As Soon As Possible",
        method: defaultMethod,
        sortKey: Number.MAX_SAFE_INTEGER,
      },
    ];
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadFaculty = useCallback(async () => {
    if (!selectedDepartment) return;
    try {
      const { data, error: err } = await kioskSupabase
        .from("faculty")
        .select(`
          *,
          queue_entries(status, called_at)
        `)
        .eq("department_id", selectedDepartment)
        .eq("status", "accepting");
      if (err) throw err;
      setFaculties(data || []);
    } catch (err) {
      setError("Failed to load faculty");
    }
  }, [selectedDepartment]);

  useEffect(() => {
    const subscription = kioskSupabase
      .channel('faculty-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'faculty' }, () => loadFaculty())
      .subscribe();
    return () => { subscription.unsubscribe(); };
  }, [loadFaculty]);

  useEffect(() => {
    const loadColleges = async () => {
      try {
        const { data, error: err } = await kioskSupabase.from("colleges").select("*").order('name');
        if (err) throw err;
        setColleges(data || []);
      } catch (err) { setError("Failed to load colleges"); }
    };
    loadColleges();
  }, []);

  useEffect(() => {
    if (!selectedCollege) return;
    const loadDepartments = async () => {
      try {
        const { data, error: err } = await kioskSupabase
          .from("departments")
          .select("*")
          .eq("college_id", selectedCollege)
          .order('name');
        if (err) throw err;
        setDepartments(data || []);
      } catch (err) { setError("Failed to load departments"); }
    };
    loadDepartments();
  }, [selectedCollege]);

  useEffect(() => { loadFaculty(); }, [loadFaculty, selectedDepartment]);

  const getFacultyWaitTime = (facultyData: any) => {
    const active = facultyData.queue_entries?.find((q: any) => q.status === 'called');
    const waiting = facultyData.queue_entries?.filter((q: any) => q.status === 'waiting').length || 0;
    
    if (!active?.called_at) return (waiting * 15) || "Ready";
    
    const start = new Date(active.called_at).getTime();
    const end = start + (15 * 60 * 1000);
    const remaining = Math.max(0, Math.floor((end - now.getTime()) / 60000));
    return remaining + (waiting * 15);
  };

  const handleCollegeSelect = (collegeId: string) => {
    setSelectedCollege(collegeId);
    setStep("department");
  };

  const handleDepartmentSelect = (deptId: string) => {
    setSelectedDepartment(deptId);
    setStep("faculty");
  };

  const handleFacultySelect = (facultyData: Faculty) => {
    setSelectedFaculty(facultyData.id);
    setConsultationConcern("");
    setSelectedSlotKey(null);
    setSelectedConsultationMethod(
      facultyData.consultation_method === "online" ? "google_meet" : "face_to_face",
    );
    setStep("type");
  };

  const selectedFacultyData = faculties.find((faculty) => faculty.id === selectedFaculty) || null;
  const slotOptions = selectedFacultyData ? parseSlotOptions(selectedFacultyData) : [];
  const selectedSlot = slotOptions.find((slot) => slot.key === selectedSlotKey) || null;

  const dispatchBookingEmail = (queueId: string) => {
    const payload = JSON.stringify({ queueId, studentEmail });
    enqueuePendingBookingEmail(queueId, studentEmail);

    const attemptDispatch = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(bookingEmailUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            // keepalive reduces dropped requests when navigation happens immediately on mobile.
            keepalive: true,
            body: payload,
          });

          if (response.ok) {
            const parsed = await response.json().catch(() => ({} as { ok?: boolean; deduped?: boolean }));
            if (parsed?.ok || parsed?.deduped) {
              clearPendingBookingEmail(queueId);
            }
          }
          return;
        } catch (dispatchError) {
          if (attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            continue;
          }

          console.warn("Booking email dispatch failed:", dispatchError);

          if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
            try {
              const beaconPayload = new Blob([payload], { type: "application/json" });
              const queued = navigator.sendBeacon(bookingEmailUrl, beaconPayload);
              if (queued) return;
            } catch (beaconError) {
              console.warn("Booking email beacon fallback failed:", beaconError);
            }
          }
        }
      }
    };

    void attemptDispatch();
  };

  const handleSlotBooking = async () => {
    const trimmedConcern = consultationConcern.trim();
    if (!trimmedConcern) {
      setError("Please write your consultation concern before booking.");
      return;
    }
    if (!selectedSlot) {
      setError("Please select a consultation time slot before booking.");
      return;
    }
    if (!selectedConsultationMethod) {
      setError("Please choose a consultation mode before booking.");
      return;
    }
    if (!isValidEmail(studentEmail)) {
      setError("A valid student email is required before booking.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (!selectedFaculty) throw new Error("Faculty not selected");
      const { data: queueEntry, error: err } = await kioskSupabase
        .from("queue_entries")
        .insert({
          faculty_id: selectedFaculty,
          student_number: studentNumber,
          consultation_type: selectedConsultationMethod,
          status: "waiting",
        })
        .select().single();
      if (err) throw err;

      const historyPayload: Array<{ queue_entry_id: string; action: string; notes: string }> = [
        {
          queue_entry_id: queueEntry.id,
          action: "concern_submitted",
          notes: trimmedConcern,
        },
      ];

      const trimmedName = studentName.trim();
      if (trimmedName) {
        historyPayload.push({
          queue_entry_id: queueEntry.id,
          action: "student_identified",
          notes: trimmedName,
        });
      }

      historyPayload.push({
        queue_entry_id: queueEntry.id,
        action: "slot_selected",
        notes: `${selectedSlot.dateLabel} ${selectedSlot.timeLabel} | ${selectedConsultationMethod.replace(/_/g, " ")}`,
      });

      if (selectedConsultationMethod === "google_meet") {
        historyPayload.push({
          queue_entry_id: queueEntry.id,
          action: "google_meet_link_shared",
          notes: createRandomGoogleMeetLink(),
        });
      }

      const { error: historyError } = await kioskSupabase.from("queue_history").insert(historyPayload);
      if (historyError) {
        // History logging should not block successful ticket booking.
        console.warn("Queue history insert failed; continuing booking:", historyError);
      }

      // Attempt email dispatch immediately after booking so students receive updates faster.
      dispatchBookingEmail(queueEntry.id);

      const nameParam = studentName ? `&name=${encodeURIComponent(studentName)}` : "";
      const emailParam = studentEmail ? `&email=${encodeURIComponent(studentEmail)}` : "";
      setLocation(`/kiosk/confirmation?queueId=${queueEntry.id}${nameParam}${emailParam}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to book queue");
    } finally { setLoading(false); }
  };

  const handleBack = () => {
    if (step === "department") { setStep("college"); setSelectedCollege(null); }
    if (step === "faculty") { setStep("department"); setSelectedDepartment(null); }
    if (step === "type") {
      setStep("faculty");
      setSelectedFaculty(null);
      setConsultationConcern("");
      setSelectedSlotKey(null);
      setSelectedConsultationMethod(null);
    }
  };

  return (
    <div className={`min-h-screen bg-[#E8E6EB] flex flex-col font-sans ${keyboardVisible ? "pb-64 md:pb-72" : ""}`}>
      
      <header className="px-4 py-6 sm:px-10 sm:py-8 flex justify-between items-center gap-3">
        <button 
          onClick={handleBack} 
          disabled={step === "college" || loading}
          className={`flex items-center gap-2 font-bold uppercase text-[10px] tracking-[0.2em] transition-all ${step === "college" ? 'opacity-0' : 'text-[#024059]/65 hover:text-[#024059]'}`}
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>

        <div className="text-center">
          <h1 className="text-sm font-black text-[#024059] uppercase tracking-[0.3em]">Booking Portal</h1>
          <p className="text-[#024059]/65 font-bold text-[10px] mt-0.5 uppercase tracking-widest">
            Student: <span className="text-slate-800">{studentName || "Verified Student"}</span>
          </p>
          <p className="text-[#024059]/55 font-bold text-[9px] mt-1 uppercase tracking-widest">
            ID: <span className="text-slate-500">{maskStudentNumber(studentNumber)}</span>
          </p>
        </div>

        <div className="bg-white px-4 py-2 rounded-full border border-[#E8E6EB] shadow-sm flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-[#024059] animate-pulse" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Active</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center p-4 sm:p-6">
        <div className="max-w-4xl w-full">
          
          <div className="relative mt-8">
            <div className="absolute -top-4 left-6 right-6 bg-[#fff9db] rounded-t-[40px] h-24 pt-3 text-center border-t border-x border-[#fef0b3] shadow-inner">
               <div className="flex justify-center gap-8 mt-1">
                  {[1,2,3,4].map(i => (
                    <div key={i} className={`h-1.5 w-12 rounded-full transition-colors ${i <= (step === 'college' ? 1 : step === 'department' ? 2 : step === 'faculty' ? 3 : 4) ? 'bg-[#d4af37]' : 'bg-[#f0e3a8]'}`} />
                  ))}
               </div>
            </div>

            <Card className="relative border-0 shadow-[0_30px_60px_rgba(0,0,0,0.06)] rounded-[32px] sm:rounded-[48px] bg-white overflow-hidden z-10">
              <CardHeader className="pt-14 pb-6 px-6 text-center sm:pt-16 sm:pb-8 sm:px-12">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-[24px] bg-[#E8E6EB]/60 text-[#024059] mb-6">
                  {step === "college" && <School className="w-8 h-8" />}
                  {step === "department" && <BookOpen className="w-8 h-8" />}
                  {step === "faculty" && <UserCircle className="w-8 h-8" />}
                  {step === "type" && <CheckCircle2 className="w-8 h-8" />}
                </div>
                <CardTitle className="text-2xl font-black text-slate-800 tracking-tight leading-tight mb-2 sm:text-4xl">
                  {step === "college" && "Select Your College"}
                  {step === "department" && "Select Your Department"}
                  {step === "faculty" && "Choose Your Professor"}
                  {step === "type" && "Select Consultation Slot"}
                </CardTitle>
                <CardDescription className="text-[#024059]/65 font-bold uppercase tracking-[0.1em] text-xs">
                  Step {step === "college" ? "1" : step === "department" ? "2" : step === "faculty" ? "3" : "4"} of 4
                </CardDescription>
              </CardHeader>

              <CardContent className="px-6 pb-12 pt-4 sm:px-12 sm:pb-20">
                {error && (
                  <Alert variant="destructive" className="mb-8 bg-[#E8E6EB]/60 border-0 text-[#024059] rounded-3xl p-5">
                    <AlertCircle className="h-5 w-5" />
                    <AlertDescription className="font-bold ml-2">{error}</AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {step === "college" && colleges.map((college) => (
                    <button 
                      key={college.id} 
                      className="group flex items-center justify-between p-7 bg-white border border-slate-100 hover:border-[#E8E6EB] hover:shadow-xl hover:shadow-[#024059]/10 rounded-[32px] transition-all duration-300 text-left"
                      onClick={() => handleCollegeSelect(college.id)}
                    >
                      <div>
                        <div className="font-black text-[#024059] text-[10px] tracking-widest uppercase mb-1.5">{college.code}</div>
                        <div className="font-bold text-slate-800 text-lg leading-tight group-hover:text-[#024059] transition-colors">{college.name}</div>
                      </div>
                      <div className="h-10 w-10 rounded-full bg-slate-50 group-hover:bg-[#E8E6EB]/60 flex items-center justify-center transition-colors">
                        <ChevronRight className="w-5 h-5 text-[#024059]/55 group-hover:text-[#024059]" />
                      </div>
                    </button>
                  ))}
                  {step === "college" && colleges.length === 0 && (
                    <div className="md:col-span-2 text-center py-24 bg-slate-50/50 rounded-[40px] border-2 border-dashed border-slate-100">
                      <School className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                      <div className="text-[#024059]/65 font-black uppercase tracking-widest text-[10px]">No colleges available</div>
                    </div>
                  )}

                  {step === "department" && departments.map((dept) => (
                    <button 
                      key={dept.id} 
                      className="group flex items-center justify-between p-7 bg-white border border-slate-100 hover:border-[#E8E6EB] hover:shadow-xl hover:shadow-[#024059]/10 rounded-[32px] transition-all duration-300 text-left"
                      onClick={() => handleDepartmentSelect(dept.id)}
                    >
                      <div>
                        <div className="font-black text-[#024059] text-[10px] tracking-widest uppercase mb-1.5">{dept.code}</div>
                        <div className="font-bold text-slate-800 text-lg leading-tight group-hover:text-[#024059] transition-colors">{dept.name}</div>
                      </div>
                      <div className="h-10 w-10 rounded-full bg-slate-50 group-hover:bg-[#E8E6EB]/60 flex items-center justify-center transition-colors">
                        <ChevronRight className="w-5 h-5 text-[#024059]/55 group-hover:text-[#024059]" />
                      </div>
                    </button>
                  ))}
                  {step === "department" && departments.length === 0 && (
                    <div className="md:col-span-2 text-center py-24 bg-slate-50/50 rounded-[40px] border-2 border-dashed border-slate-100">
                      <BookOpen className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                      <div className="text-[#024059]/65 font-black uppercase tracking-widest text-[10px]">No departments available</div>
                    </div>
                  )}

                  {step === "faculty" && (
                    <div className="grid grid-cols-1 gap-4 md:col-span-2">
                      {faculties.length > 0 ? faculties.map((faculty) => {
                        const wait = getFacultyWaitTime(faculty);
                        return (
                          <button 
                            key={faculty.id} 
                            className="group flex items-center justify-between p-6 bg-white border border-slate-100 hover:border-[#E8E6EB] hover:shadow-lg rounded-[32px] transition-all duration-300 text-left"
                            onClick={() => handleFacultySelect(faculty)}
                          >
                            <div className="flex items-center gap-6">
                              <div className="h-14 w-14 rounded-2xl bg-[#E8E6EB]/60 flex items-center justify-center text-[#024059] font-black text-xl shadow-sm">
                                {faculty.name[0]}
                              </div>
                              <div>
                                <div className="font-black text-slate-800 text-xl group-hover:text-[#024059] transition-colors">{faculty.name}</div>
                                <div className="flex items-center gap-2 mt-1">
                                  <Clock className="w-3 h-3 text-[#024059]/55" />
                                  <span className="text-[#024059]/65 font-bold text-[10px] uppercase tracking-widest">
                                    Est. Wait: <span className="text-[#024059]">{typeof wait === 'number' ? `~${wait} mins` : wait}</span>
                                  </span>
                                </div>
                              </div>
                            </div>
                            <Badge className="bg-[#E8E6EB]/60 text-[#024059] border-0 uppercase text-[9px] px-3 py-1.5 font-black tracking-widest rounded-full">Available</Badge>
                          </button>
                        );
                      }) : (
                        <div className="text-center py-24 bg-slate-50/50 rounded-[40px] border-2 border-dashed border-slate-100">
                          <UserCircle className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                          <div className="text-[#024059]/65 font-black uppercase tracking-widest text-[10px]">No Active Professors</div>
                        </div>
                      )}
                    </div>
                  )}

                  {step === "type" && (
                    <div className="md:col-span-2 space-y-5">
                      <div className="rounded-[28px] border border-slate-100 bg-slate-50 p-6 text-left">
                        <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-[0.2em] mb-3">
                          Consultation Mode
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedConsultationMethod("face_to_face")}
                            className={`rounded-2xl border p-4 text-left transition-all ${
                              selectedConsultationMethod === "face_to_face"
                                ? "border-[#024059] bg-[#E8E6EB]/60"
                                : "border-slate-200 bg-white hover:border-[#E8E6EB]"
                            }`}
                          >
                            <p className="text-[10px] font-black uppercase tracking-widest text-[#024059]/65">
                              In-Person
                            </p>
                            <p className="text-lg font-black text-slate-800 mt-1">Face-to-Face</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedConsultationMethod("google_meet")}
                            className={`rounded-2xl border p-4 text-left transition-all ${
                              selectedConsultationMethod === "google_meet"
                                ? "border-[#024059] bg-[#E8E6EB]/60"
                                : "border-slate-200 bg-white hover:border-[#E8E6EB]"
                            }`}
                          >
                            <p className="text-[10px] font-black uppercase tracking-widest text-[#024059]/65">
                              Remote
                            </p>
                            <p className="text-lg font-black text-slate-800 mt-1">Online (Google Meet)</p>
                          </button>
                        </div>
                      </div>

                      <div className="rounded-[28px] border border-slate-100 bg-slate-50 p-6 text-left">
                        <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-[0.2em] mb-3">
                          Consultation Concern (Required)
                        </p>
                        <textarea
                          value={consultationConcern}
                          onChange={(e) => setConsultationConcern(e.target.value)}
                          onFocus={() => {
                            if (shouldUseOnScreenKeyboard) setKeyboardVisible(true);
                          }}
                          placeholder="Write your concern so the professor can prepare before your consultation."
                          className="w-full min-h-[120px] rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#E8E6EB]"
                          maxLength={500}
                        />
                        <p className="text-[10px] font-bold text-[#024059]/65 uppercase tracking-widest mt-2 text-right">
                          {consultationConcern.length}/500
                        </p>
                      </div>

                      <div className="rounded-[28px] border border-slate-100 bg-slate-50 p-6 text-left">
                        <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-[0.2em] mb-3">
                          Available Time Slots
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {slotOptions.map((slot) => (
                            <button
                              key={slot.key}
                              type="button"
                              onClick={() => setSelectedSlotKey(slot.key)}
                              className={`rounded-2xl border p-4 text-left transition-all ${
                                selectedSlotKey === slot.key
                                  ? "border-[#024059] bg-[#E8E6EB]/60"
                                  : "border-slate-200 bg-white hover:border-[#E8E6EB]"
                              }`}
                            >
                              <p className="text-[10px] font-black uppercase tracking-widest text-[#024059]/65">
                                {slot.dateLabel}
                              </p>
                              <p className="text-lg font-black text-slate-800 mt-1">{slot.timeLabel}</p>
                              <p className="text-[10px] font-black uppercase tracking-widest text-[#024059] mt-2">
                                {selectedConsultationMethod === "google_meet" ? "Online (Google Meet)" : "Face-to-Face"}
                              </p>
                            </button>
                          ))}
                          {slotOptions.length === 0 && (
                            <p className="text-[10px] font-black uppercase tracking-widest text-[#024059]/65">
                              No available time slots configured by this professor.
                            </p>
                          )}
                        </div>
                      </div>

                      <Button
                        type="button"
                        onClick={handleSlotBooking}
                        disabled={loading || !consultationConcern.trim() || !selectedSlot || !selectedConsultationMethod}
                        className="w-full h-16 bg-[#024059] hover:bg-[#024059] rounded-2xl font-black text-white uppercase tracking-[0.2em]"
                      >
                        Confirm Booking
                      </Button>
                    </div>
                  )}

                </div>
              </CardContent>
            </Card>
          </div>
          
          <div className="mt-8">
             <Button
              type="button"
              onClick={() => setLocation("/kiosk")}
              disabled={loading}
              variant="outline"
              className="w-full h-14 border-[#024059] text-[#024059] bg-white hover:bg-[#E8E6EB]/60 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-sm"
             >
              Cancel Booking
             </Button>
          </div>
        </div>
      </main>

      {loading && (
        <div className="fixed inset-0 bg-white/90 backdrop-blur-md z-50 flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="relative">
            <Loader2 className="w-20 h-20 animate-spin text-[#024059] opacity-20" />
            <CheckCircle2 className="w-10 h-10 text-[#024059] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
          </div>
          <p className="font-black text-[#024059] uppercase tracking-[0.4em] text-[10px] mt-8">Booking Ticket...</p>
        </div>
      )}

      {keyboardVisible && step === "type" && (
        <OnScreenKeyboard
          title="Consultation Keyboard"
          value={consultationConcern}
          onChange={setConsultationConcern}
          onEnter={() => setKeyboardVisible(false)}
          onClose={() => setKeyboardVisible(false)}
          mode="text"
        />
      )}
    </div>
  );
}
