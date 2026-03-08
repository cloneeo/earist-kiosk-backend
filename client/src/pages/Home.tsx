import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { QrCode, LogOut, Monitor, Clock3, ArrowRight } from "lucide-react";
import { kioskSupabase } from "@/lib/supabaseKiosk";

type QueueStatus = "waiting" | "called";

type QueueEntryRow = {
  id: string;
  faculty_id: string;
  student_number: string | null;
  status: QueueStatus;
  called_at: string | null;
};

type StudentRow = {
  student_number: string | null;
  full_name: string | null;
  student_name: string | null;
  name: string | null;
};

type SummaryState = {
  inSessionStudent: string;
  inSessionFaculty: string;
  waitingCount: number;
  activeFacultyCount: number;
};

export default function Home() {
  const { isAuthenticated, signOut } = useAuth();
  const [, setLocation] = useLocation();

  const [summary, setSummary] = useState<SummaryState>({
    inSessionStudent: "No active consultation",
    inSessionFaculty: "",
    waitingCount: 0,
    activeFacultyCount: 0,
  });
  const [loadingSummary, setLoadingSummary] = useState(true);

  const normalizeStudentNumber = (studentId: string) => studentId.trim().toUpperCase();

  const maskStudentNumber = (studentId: string) => {
    const normalized = normalizeStudentNumber(studentId);
    if (!normalized) return "";
    const parts = normalized.split("-");
    if (parts.length === 2) {
      const suffix = parts[1].slice(-1);
      return `${parts[0]}-*****${suffix}`;
    }
    return `${normalized.slice(0, 3)}*****${normalized.slice(-1)}`;
  };

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);

    const [queueRes, facultyRes] = await Promise.all([
      kioskSupabase
        .from("queue_entries")
        .select("id, faculty_id, student_number, status, called_at")
        .in("status", ["waiting", "called"]),
      kioskSupabase.from("faculty").select("id, name").eq("status", "accepting"),
    ]);

    if (queueRes.error) {
      console.error("Failed to load kiosk summary queue:", queueRes.error);
      setLoadingSummary(false);
      return;
    }

    if (facultyRes.error) {
      console.error("Failed to load kiosk summary faculties:", facultyRes.error);
      setLoadingSummary(false);
      return;
    }

    const queueEntries = (queueRes.data || []) as QueueEntryRow[];
    const calledEntry = queueEntries
      .filter((entry) => entry.status === "called")
      .sort((a, b) => {
        const left = a.called_at ? new Date(a.called_at).getTime() : 0;
        const right = b.called_at ? new Date(b.called_at).getTime() : 0;
        return right - left;
      })[0];

    const waitingCount = queueEntries.filter((entry) => entry.status === "waiting").length;
    const facultyById = new Map((facultyRes.data || []).map((row) => [row.id, row.name || "Professor"]));

    let inSessionStudent = "No active consultation";
    if (calledEntry?.student_number) {
      const normalized = normalizeStudentNumber(calledEntry.student_number);

      const [historyRes, studentRes] = await Promise.all([
        kioskSupabase
          .from("queue_history")
          .select("notes")
          .eq("queue_entry_id", calledEntry.id)
          .eq("action", "student_identified")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        kioskSupabase
          .from("students")
          .select("student_number, full_name, student_name, name")
          .eq("student_number", normalized)
          .maybeSingle(),
      ]);

      const historyName = (historyRes.data?.notes || "").trim();
      const studentRow = studentRes.data as StudentRow | null;
      const directoryName =
        (studentRow?.full_name || "").trim() ||
        (studentRow?.student_name || "").trim() ||
        (studentRow?.name || "").trim();

      inSessionStudent = historyName || directoryName || maskStudentNumber(normalized);
    }

    setSummary({
      inSessionStudent,
      inSessionFaculty: calledEntry ? facultyById.get(calledEntry.faculty_id) || "Professor" : "",
      waitingCount,
      activeFacultyCount: (facultyRes.data || []).length,
    });
    setLoadingSummary(false);
  }, []);

  useEffect(() => {
    void loadSummary();

    const queueChannel = kioskSupabase
      .channel("home-summary-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, () => void loadSummary())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_history" }, () => void loadSummary())
      .subscribe();

    const facultyChannel = kioskSupabase
      .channel("home-summary-faculty")
      .on("postgres_changes", { event: "*", schema: "public", table: "faculty" }, () => void loadSummary())
      .subscribe();

    return () => {
      kioskSupabase.removeChannel(queueChannel);
      kioskSupabase.removeChannel(facultyChannel);
    };
  }, [loadSummary]);

  return (
    <div className="min-h-screen bg-[#f3f1f6] font-sans flex flex-col">
      <nav className="bg-white border-b border-[#E8E6EB] px-4 py-4 sm:px-8 sticky top-0 z-30 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#024059] rounded-xl flex items-center justify-center shadow-md text-white font-black text-xs">EQ</div>
          <h1 className="text-xl font-black text-[#024059] uppercase tracking-tight">EARIST Kiosk</h1>
        </div>
        {isAuthenticated && (
          <Button variant="ghost" onClick={() => signOut()} className="text-[#024059]/65 hover:text-[#024059] uppercase text-[10px] font-black tracking-widest">
            <LogOut size={16} className="mr-2" /> Sign Out
          </Button>
        )}
      </nav>

      <main className="max-w-7xl mx-auto w-full px-4 py-6 sm:px-8 sm:py-12 flex flex-col lg:flex-row gap-6 sm:gap-10">
        <div className="lg:w-[58%]">
          <Card className="border-0 shadow-2xl rounded-[48px] overflow-hidden bg-white lg:sticky lg:top-24">
            <div className="p-7 text-center sm:p-10 border-b border-[#f1e5e5]">
              <h2 className="text-3xl font-black uppercase leading-none tracking-tighter sm:text-4xl text-[#c62828]">Student Registration</h2>
              <p className="text-[#c62828] mt-3 text-sm font-black uppercase tracking-widest">Scan Student ID to Book Consultation</p>
            </div>
            <CardContent className="p-8 sm:p-12 text-center flex flex-col items-center">
              <div className="mb-8 w-full max-w-md p-8 rounded-[36px] bg-[#fff5f5] border-2 border-dashed border-[#f1c4c4] flex flex-col items-center justify-center min-h-56">
                <QrCode className="w-16 h-16 text-[#c62828] mb-4" />
                <p className="text-[#7a3030] text-sm font-black uppercase tracking-wider">
                  Present your school ID on the scanner.
                </p>
              </div>

              <Button
                onClick={() => setLocation("/kiosk")}
                className="w-full max-w-md bg-[#c62828] hover:bg-[#b22222] h-20 rounded-[32px] font-black uppercase text-white shadow-xl shadow-[#c62828]/25 text-lg transition-transform active:scale-95"
              >
                Start Booking <ArrowRight size={18} className="ml-2" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:w-[42%] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-6">
          <button
            type="button"
            onClick={() => setLocation("/kiosk/monitor")}
            className="text-left h-full"
          >
            <Card className="h-full min-h-[260px] sm:min-h-[300px] lg:min-h-[280px] border-0 shadow-xl rounded-[40px] bg-white overflow-hidden transition-transform hover:-translate-y-1 active:scale-[0.99]">
              <CardContent className="p-6 sm:p-7 h-full flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#024059]/60">Live Monitor</p>
                  <Monitor size={20} className="text-[#c62828]" />
                </div>

                <div className="space-y-2 mt-5">
                  <p className="text-xs font-black uppercase tracking-wide text-[#024059]/60">In Session</p>
                  <p className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">{loadingSummary ? "Loading..." : summary.inSessionStudent}</p>
                  <p className="text-[11px] font-bold text-[#024059]/70 uppercase tracking-wide">{summary.inSessionFaculty || "No assigned faculty"}</p>
                </div>

                <div className="mt-5 flex items-center justify-between rounded-2xl bg-[#f5f8fa] border border-[#e6edf2] px-4 py-3">
                  <span className="text-[11px] font-black uppercase tracking-widest text-[#024059]/70">Waiting</span>
                  <span className="text-xl font-black text-[#024059]">{loadingSummary ? "-" : summary.waitingCount}</span>
                </div>

                <p className="mt-4 text-[10px] font-black uppercase tracking-wider text-[#c62828]">Tap to view all professor queues</p>
              </CardContent>
            </Card>
          </button>

          <button
            type="button"
            onClick={() => setLocation("/kiosk/schedules")}
            className="text-left h-full"
          >
            <Card className="h-full min-h-[260px] sm:min-h-[300px] lg:min-h-[280px] border-0 shadow-xl rounded-[40px] bg-white overflow-hidden transition-transform hover:-translate-y-1 active:scale-[0.99]">
              <CardContent className="p-6 sm:p-7 h-full flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#024059]/60">Prof Schedules</p>
                  <Clock3 size={20} className="text-[#c62828]" />
                </div>

                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-[#fff0f0] flex items-center justify-center">
                      <Clock3 size={18} className="text-[#c62828]" />
                    </div>
                    <div>
                      <p className="text-lg font-black text-slate-900">View Availability</p>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[#024059]/70">Consultation Hours and Method</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between rounded-2xl bg-[#f5f8fa] border border-[#e6edf2] px-4 py-3">
                  <span className="text-[11px] font-black uppercase tracking-widest text-[#024059]/70">Active Faculty</span>
                  <span className="text-xl font-black text-[#024059]">{loadingSummary ? "-" : summary.activeFacultyCount}</span>
                </div>

                <p className="mt-4 text-[10px] font-black uppercase tracking-wider text-[#c62828]">Tap to open searchable directory</p>
              </CardContent>
            </Card>
          </button>

        </div>
      </main>

      <footer className="mt-auto px-4 py-8 bg-white border-t border-slate-100 text-center sm:px-12 sm:py-10">
        <p className="text-[10px] font-black text-slate-200 uppercase tracking-[0.6em] leading-none">
          EARIST QUEUE MANAGEMENT SYSTEM (c) 2026
        </p>
      </footer>
    </div>
  );
}
