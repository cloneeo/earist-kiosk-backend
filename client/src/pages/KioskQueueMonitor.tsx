import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { kioskSupabase } from "@/lib/supabaseKiosk";
import { ChevronLeft, Monitor, Search, Users } from "lucide-react";

type QueueEntry = {
  id: string;
  student_number: string | null;
  status: "waiting" | "called" | "completed" | "cancelled" | "rescheduled";
  called_at: string | null;
  created_at: string;
};

type FacultyWithQueue = {
  id: string;
  name: string;
  consultation_method: string | null;
  department: { name: string } | { name: string }[] | null;
  queue_entries: QueueEntry[] | null;
};

type StudentRow = {
  student_number: string | null;
  full_name: string | null;
  student_name: string | null;
  name: string | null;
};

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

const getDepartmentName = (department: FacultyWithQueue["department"]) => {
  if (!department) return "No department";
  if (Array.isArray(department)) return department[0]?.name || "No department";
  return department.name || "No department";
};

export default function KioskQueueMonitor() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<
    Array<{
      id: string;
      facultyName: string;
      departmentName: string;
      methodLabel: string;
      inSession: string;
      waitingCount: number;
      queuePreview: string[];
    }>
  >([]);

  const loadMonitor = useCallback(async () => {
    setLoading(true);

    const { data: facultyRows, error: facultyError } = await kioskSupabase
      .from("faculty")
      .select("id, name, consultation_method, status, department:departments(name), queue_entries(id, student_number, status, called_at, created_at)")
      .eq("status", "accepting")
      .order("name");

    if (facultyError) {
      console.error("Failed to load monitor rows:", facultyError);
      setLoading(false);
      return;
    }

    const typedRows = (facultyRows || []) as FacultyWithQueue[];

    const activeQueues = typedRows.flatMap((row) =>
      (row.queue_entries || []).filter((entry) => entry.status === "called" || entry.status === "waiting"),
    );

    const queueEntryIds = activeQueues.map((entry) => entry.id);
    const studentNumbers = Array.from(
      new Set(
        activeQueues
          .map((entry) => normalizeStudentNumber(entry.student_number || ""))
          .filter(Boolean),
      ),
    );

    let historyNameMap: Record<string, string> = {};
    if (queueEntryIds.length > 0) {
      const { data: historyRows, error: historyError } = await kioskSupabase
        .from("queue_history")
        .select("queue_entry_id, notes, created_at")
        .in("queue_entry_id", queueEntryIds)
        .eq("action", "student_identified")
        .order("created_at", { ascending: false });

      if (historyError) {
        console.error("Failed to load monitor identity history:", historyError);
      } else if (historyRows) {
        historyNameMap = historyRows.reduce((acc, row) => {
          if (!acc[row.queue_entry_id] && row.notes) acc[row.queue_entry_id] = row.notes;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    let studentNameMap: Record<string, string> = {};
    if (studentNumbers.length > 0) {
      const { data: studentRows, error: studentError } = await kioskSupabase
        .from("students")
        .select("student_number, full_name, student_name, name")
        .in("student_number", studentNumbers);

      if (studentError) {
        console.error("Failed to load monitor student directory:", studentError);
      } else if (studentRows) {
        studentNameMap = (studentRows as StudentRow[]).reduce((acc, row) => {
          const key = normalizeStudentNumber(row.student_number || "");
          const resolvedName =
            (row.full_name || "").trim() ||
            (row.student_name || "").trim() ||
            (row.name || "").trim();
          if (key && resolvedName) acc[key] = resolvedName;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    const displayName = (entry: QueueEntry) => {
      const key = normalizeStudentNumber(entry.student_number || "");
      return (
        historyNameMap[entry.id] ||
        studentNameMap[key] ||
        maskStudentNumber(entry.student_number || "") ||
        "Unknown"
      );
    };

    const formattedRows = typedRows.map((faculty) => {
      const activeEntries = (faculty.queue_entries || [])
        .filter((entry) => entry.status === "called" || entry.status === "waiting")
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      const inSessionEntry = activeEntries
        .filter((entry) => entry.status === "called")
        .sort((a, b) => {
          const left = a.called_at ? new Date(a.called_at).getTime() : 0;
          const right = b.called_at ? new Date(b.called_at).getTime() : 0;
          return right - left;
        })[0];

      const waitingEntries = activeEntries.filter((entry) => entry.status === "waiting");

      return {
        id: faculty.id,
        facultyName: faculty.name,
        departmentName: getDepartmentName(faculty.department),
        methodLabel: faculty.consultation_method === "online" ? "Online" : "F2F",
        inSession: inSessionEntry ? displayName(inSessionEntry) : "No active consultation",
        waitingCount: waitingEntries.length,
        queuePreview: waitingEntries.slice(0, 3).map((entry) => displayName(entry)),
      };
    });

    setRows(formattedRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadMonitor();

    const channel = kioskSupabase
      .channel("kiosk-monitor-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, () => void loadMonitor())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_history" }, () => void loadMonitor())
      .on("postgres_changes", { event: "*", schema: "public", table: "faculty" }, () => void loadMonitor())
      .subscribe();

    return () => {
      kioskSupabase.removeChannel(channel);
    };
  }, [loadMonitor]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      return (
        row.facultyName.toLowerCase().includes(needle) ||
        row.departmentName.toLowerCase().includes(needle)
      );
    });
  }, [rows, search]);

  return (
    <div className="min-h-screen bg-[#f4f2f7] p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" className="w-fit text-[#024059]" onClick={() => setLocation("/")}>
            <ChevronLeft size={18} className="mr-2" /> Back to Home
          </Button>
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 text-[#024059]/55 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search professor or department"
              className="pl-9 rounded-2xl border-[#d9dde2] bg-white"
            />
          </div>
        </div>

        <Card className="rounded-[28px] border-0 shadow-sm bg-white">
          <CardContent className="p-6 sm:p-7">
            <div className="flex items-center gap-3 mb-2">
              <Monitor className="text-[#c62828]" size={20} />
              <h1 className="text-2xl font-black tracking-tight text-[#024059]">Professor Queue Monitor</h1>
            </div>
            <p className="text-sm text-[#024059]/70">Live faculty-by-faculty view of current consultations and waiting students.</p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loading && (
            <Card className="md:col-span-2 rounded-[24px] border-0 shadow-sm">
              <CardContent className="p-10 text-center text-[#024059]/65 text-sm font-bold uppercase tracking-wider">
                Loading queue monitor...
              </CardContent>
            </Card>
          )}

          {!loading && filteredRows.length === 0 && (
            <Card className="md:col-span-2 rounded-[24px] border-0 shadow-sm">
              <CardContent className="p-10 text-center text-[#024059]/65 text-sm font-bold uppercase tracking-wider">
                No faculty rows match your search.
              </CardContent>
            </Card>
          )}

          {!loading &&
            filteredRows.map((row) => (
              <Card key={row.id} className="rounded-[24px] border-0 shadow-sm bg-white overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-slate-900 leading-tight">{row.facultyName}</p>
                      <p className="text-xs font-bold uppercase tracking-wide text-[#024059]/60">{row.departmentName}</p>
                    </div>
                    <Badge className="bg-[#eef4f8] text-[#024059] hover:bg-[#eef4f8] border-0 uppercase text-[10px] font-black tracking-wide">
                      {row.methodLabel}
                    </Badge>
                  </div>

                  <div className="mt-5 rounded-2xl border border-[#e4e9ef] bg-[#f8fbfd] p-4">
                    <p className="text-[10px] uppercase font-black tracking-wider text-[#024059]/65 mb-1">In Session</p>
                    <p className="font-black text-base text-slate-900">{row.inSession}</p>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-sm">
                    <p className="text-[10px] uppercase font-black tracking-wider text-[#024059]/65 flex items-center gap-1">
                      <Users size={14} /> Waiting
                    </p>
                    <p className="font-black text-[#024059]">{row.waitingCount}</p>
                  </div>

                  <div className="mt-3 space-y-2">
                    {row.queuePreview.length > 0 ? (
                      row.queuePreview.map((name) => (
                        <div key={name} className="text-sm font-bold text-slate-700 rounded-xl bg-[#f7f7fb] px-3 py-2">
                          {name}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm font-bold text-[#024059]/50 rounded-xl bg-[#f7f7fb] px-3 py-2">
                        No waiting students.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>
    </div>
  );
}
