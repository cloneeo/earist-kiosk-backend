import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  department_id: string | null;
  department: {
    id?: string;
    name?: string;
    college_id?: string;
    college?: { id?: string; name?: string } | Array<{ id?: string; name?: string }>;
  } | Array<{
    id?: string;
    name?: string;
    college_id?: string;
    college?: { id?: string; name?: string } | Array<{ id?: string; name?: string }>;
  }> | null;
  queue_entries: QueueEntry[] | null;
};

type StudentRow = {
  student_number: string | null;
  full_name: string | null;
  student_name: string | null;
  name: string | null;
};

type CollegeRow = {
  id: string;
  name: string;
  code: string | null;
};

type DepartmentRow = {
  id: string;
  name: string;
  college_id: string | null;
};

type MonitorRow = {
  id: string;
  facultyName: string;
  departmentId: string;
  departmentName: string;
  collegeId: string;
  collegeName: string;
  methodLabel: string;
  inSession: string;
  waitingCount: number;
  queuePreview: string[];
  queueStudents: Array<{ entryId: string; displayName: string; studentNumber: string }>;
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

const getDepartmentValue = (department: FacultyWithQueue["department"]) => {
  if (!department) {
    return { id: "unassigned-dept", name: "No department", collegeId: "unassigned-college", collegeName: "No college" };
  }

  const source = Array.isArray(department) ? department[0] : department;
  const collegeSource = Array.isArray(source?.college) ? source.college[0] : source?.college;

  return {
    id: String(source?.id || source?.name || "unassigned-dept"),
    name: String(source?.name || "No department"),
    collegeId: String(source?.college_id || collegeSource?.id || collegeSource?.name || "unassigned-college"),
    collegeName: String(collegeSource?.name || "No college"),
  };
};

export default function KioskQueueMonitor() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [studentLookup, setStudentLookup] = useState("");
  const [selectedCollege, setSelectedCollege] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedFaculty, setSelectedFaculty] = useState("all");
  const [selectedStudentEntry, setSelectedStudentEntry] = useState("all");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [colleges, setColleges] = useState<CollegeRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);

  const loadLookups = useCallback(async () => {
    const [collegeResult, departmentResult] = await Promise.all([
      kioskSupabase.from("colleges").select("id, name, code").order("name"),
      kioskSupabase.from("departments").select("id, name, college_id").order("name"),
    ]);

    if (collegeResult.error) {
      console.error("Failed to load college options:", collegeResult.error);
    } else {
      setColleges((collegeResult.data || []) as CollegeRow[]);
    }

    if (departmentResult.error) {
      console.error("Failed to load department options:", departmentResult.error);
    } else {
      setDepartments((departmentResult.data || []) as DepartmentRow[]);
    }
  }, []);

  const loadMonitor = useCallback(async () => {
    setLoading(true);

    const { data: facultyRows, error: facultyError } = await kioskSupabase
      .from("faculty")
      .select("id, name, consultation_method, status, department_id, department:departments(id, name, college_id, college:colleges(id, name)), queue_entries(id, student_number, status, called_at, created_at)")
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
      return historyNameMap[entry.id] || studentNameMap[key] || maskStudentNumber(entry.student_number || "") || "Unknown";
    };

    const formattedRows = typedRows.map((faculty) => {
      const dept = getDepartmentValue(faculty.department);
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
        departmentId: dept.id,
        departmentName: dept.name,
        collegeId: dept.collegeId,
        collegeName: dept.collegeName,
        methodLabel: faculty.consultation_method === "online" ? "Online" : "F2F",
        inSession: inSessionEntry ? displayName(inSessionEntry) : "No active consultation",
        waitingCount: waitingEntries.length,
        queuePreview: waitingEntries.slice(0, 3).map((entry) => displayName(entry)),
        queueStudents: activeEntries.map((entry) => ({
          entryId: entry.id,
          displayName: displayName(entry),
          studentNumber: normalizeStudentNumber(entry.student_number || ""),
        })),
      } as MonitorRow;
    });

    setRows(formattedRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadMonitor();
    void loadLookups();

    const channel = kioskSupabase
      .channel("kiosk-monitor-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, () => void loadMonitor())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_history" }, () => void loadMonitor())
      .on("postgres_changes", { event: "*", schema: "public", table: "faculty" }, () => void loadMonitor())
      .on("postgres_changes", { event: "*", schema: "public", table: "colleges" }, () => void loadLookups())
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () => void loadLookups())
      .subscribe();

    return () => {
      kioskSupabase.removeChannel(channel);
    };
  }, [loadMonitor, loadLookups]);

  const collegeOptions = useMemo(() => {
    const fromLookup = colleges.map((college) => ({
      id: college.id,
      name: college.code ? `${college.code} - ${college.name}` : college.name,
    }));

    const fallback = rows
      .filter((row) => !fromLookup.some((college) => college.id === row.collegeId))
      .map((row) => ({ id: row.collegeId, name: row.collegeName }));

    return [...fromLookup, ...fallback].sort((a, b) => a.name.localeCompare(b.name));
  }, [colleges, rows]);

  const departmentOptions = useMemo(() => {
    const lookupRows = departments.filter((department) => {
      if (selectedCollege === "all") return true;
      return department.college_id === selectedCollege;
    });

    const fromLookup = lookupRows.map((department) => ({ id: department.id, name: department.name }));

    const fallback = rows
      .filter((row) => {
        if (selectedCollege !== "all" && row.collegeId !== selectedCollege) return false;
        return !fromLookup.some((department) => department.id === row.departmentId);
      })
      .map((row) => ({ id: row.departmentId, name: row.departmentName }));

    return [...fromLookup, ...fallback].sort((a, b) => a.name.localeCompare(b.name));
  }, [departments, rows, selectedCollege]);

  const facultyOptions = useMemo(() => {
    const source = rows.filter((row) => {
      if (selectedCollege !== "all" && row.collegeId !== selectedCollege) return false;
      if (selectedDepartment !== "all" && row.departmentId !== selectedDepartment) return false;
      return true;
    });
    return source.map((row) => ({ id: row.id, name: row.facultyName })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, selectedCollege, selectedDepartment]);

  useEffect(() => {
    if (selectedDepartment === "all") return;
    const exists = departmentOptions.some((option) => option.id === selectedDepartment);
    if (!exists) setSelectedDepartment("all");
  }, [selectedDepartment, departmentOptions]);

  useEffect(() => {
    if (selectedFaculty === "all") return;
    const exists = facultyOptions.some((option) => option.id === selectedFaculty);
    if (!exists) setSelectedFaculty("all");
  }, [selectedFaculty, facultyOptions]);

  const studentOptions = useMemo(() => {
    const source = rows.filter((row) => {
      if (selectedCollege !== "all" && row.collegeId !== selectedCollege) return false;
      if (selectedDepartment !== "all" && row.departmentId !== selectedDepartment) return false;
      if (selectedFaculty !== "all" && row.id !== selectedFaculty) return false;
      return true;
    });

    const all = source.flatMap((row) =>
      row.queueStudents.map((student) => ({
        value: `${row.id}:${student.entryId}`,
        label: `${student.displayName} - ${maskStudentNumber(student.studentNumber)} - ${row.facultyName}`,
        searchText: `${student.displayName} ${student.studentNumber} ${row.facultyName}`.toLowerCase(),
      })),
    );

    const lookup = studentLookup.trim().toLowerCase();
    return lookup ? all.filter((item) => item.searchText.includes(lookup)) : all;
  }, [rows, selectedCollege, selectedDepartment, selectedFaculty, studentLookup]);

  useEffect(() => {
    if (selectedStudentEntry === "all") return;
    const exists = studentOptions.some((option) => option.value === selectedStudentEntry);
    if (!exists) setSelectedStudentEntry("all");
  }, [selectedStudentEntry, studentOptions]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (selectedCollege !== "all" && row.collegeId !== selectedCollege) return false;
      if (selectedDepartment !== "all" && row.departmentId !== selectedDepartment) return false;
      if (selectedFaculty !== "all" && row.id !== selectedFaculty) return false;
      if (selectedStudentEntry !== "all") {
        const [, entryId] = selectedStudentEntry.split(":");
        if (!row.queueStudents.some((student) => student.entryId === entryId)) return false;
      }

      if (!needle) return true;

      const queueText = row.queueStudents.map((student) => `${student.displayName} ${student.studentNumber}`).join(" ").toLowerCase();
      return (
        row.facultyName.toLowerCase().includes(needle) ||
        row.departmentName.toLowerCase().includes(needle) ||
        row.collegeName.toLowerCase().includes(needle) ||
        queueText.includes(needle)
      );
    });
  }, [rows, search, selectedCollege, selectedDepartment, selectedFaculty, selectedStudentEntry]);

  return (
    <div className="min-h-screen bg-[#f4f2f7] p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" className="w-fit text-[#024059]" onClick={() => setLocation("/kiosk")}>
            <ChevronLeft size={18} className="mr-2" /> Back to Home
          </Button>
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 text-[#024059]/55 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search professor, department, college, or student"
              className="pl-9 rounded-2xl border-[#d9dde2] bg-white"
            />
          </div>
        </div>

        <Card className="rounded-[28px] border-0 shadow-sm bg-white">
          <CardContent className="p-6 sm:p-7 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Monitor className="text-[#c62828]" size={20} />
              <h1 className="text-2xl font-black tracking-tight text-[#024059]">Professor Queue Monitor</h1>
            </div>
            <p className="text-sm text-[#024059]/70">Filter by college, department, faculty, or student name/number for faster lookup.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Select
                value={selectedCollege}
                onValueChange={(value) => {
                  setSelectedCollege(value);
                  setSelectedDepartment("all");
                  setSelectedFaculty("all");
                  setSelectedStudentEntry("all");
                }}
              >
                <SelectTrigger className="rounded-xl bg-white"><SelectValue placeholder="College" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Colleges</SelectItem>
                  {collegeOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedDepartment}
                onValueChange={(value) => {
                  setSelectedDepartment(value);
                  setSelectedFaculty("all");
                  setSelectedStudentEntry("all");
                }}
              >
                <SelectTrigger className="rounded-xl bg-white"><SelectValue placeholder="Department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departmentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedFaculty}
                onValueChange={(value) => {
                  setSelectedFaculty(value);
                  setSelectedStudentEntry("all");
                }}
              >
                <SelectTrigger className="rounded-xl bg-white"><SelectValue placeholder="Faculty" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Faculty</SelectItem>
                  {facultyOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedStudentEntry} onValueChange={setSelectedStudentEntry}>
                <SelectTrigger className="rounded-xl bg-white"><SelectValue placeholder="Student (scroll list)" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">All Students</SelectItem>
                  {studentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-[#024059]/55 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={studentLookup}
                onChange={(event) => setStudentLookup(event.target.value)}
                placeholder="Type student number or name"
                className="pl-9 rounded-xl border-[#d9dde2] bg-white"
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loading && (
            <Card className="md:col-span-2 rounded-[24px] border-0 shadow-sm">
              <CardContent className="p-6 sm:p-10 text-center text-[#024059]/65 text-sm font-bold uppercase tracking-wider">
                Loading queue monitor...
              </CardContent>
            </Card>
          )}

          {!loading && filteredRows.length === 0 && (
            <Card className="md:col-span-2 rounded-[24px] border-0 shadow-sm">
              <CardContent className="p-6 sm:p-10 text-center text-[#024059]/65 text-sm font-bold uppercase tracking-wider">
                No faculty rows match your filters.
              </CardContent>
            </Card>
          )}

          {!loading &&
            filteredRows.map((row) => (
              <Card key={row.id} className="rounded-[24px] border-0 shadow-sm bg-white overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-lg font-black text-slate-900 leading-tight break-words">{row.facultyName}</p>
                      <p className="text-xs font-bold uppercase tracking-wide text-[#024059]/60">{row.departmentName} - {row.collegeName}</p>
                    </div>
                    <Badge className="w-fit bg-[#eef4f8] text-[#024059] hover:bg-[#eef4f8] border-0 uppercase text-[10px] font-black tracking-wide">
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

                  <div className="mt-3 space-y-2 max-h-36 overflow-y-auto pr-1">
                    {row.queuePreview.length > 0 ? (
                      row.queuePreview.map((name) => (
                        <div key={`${row.id}-${name}`} className="text-sm font-bold text-slate-700 rounded-xl bg-[#f7f7fb] px-3 py-2 break-words">
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
