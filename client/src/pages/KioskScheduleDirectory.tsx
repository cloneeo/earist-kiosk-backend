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
import { ChevronLeft, Clock3, Search } from "lucide-react";

type FacultySchedule = {
  id: string;
  name: string;
  consultation_method: string | null;
  schedule: string | null;
  status: string | null;
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
};

type ParsedSlot = {
  dateLabel: string;
  timeLabel: string;
  methodLabel: string;
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

const getDepartmentValue = (department: FacultySchedule["department"]) => {
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

const methodLabel = (method: string | null) => (method === "online" ? "Online" : "Face-to-Face");

const parseSchedule = (raw: string | null): ParsedSlot[] => {
  const source = String(raw || "").trim();
  if (!source) return [];

  try {
    const parsed = JSON.parse(source) as {
      mode?: string;
      dates?: string[];
      slots?: Array<{ time?: string; method?: "face_to_face" | "google_meet" }>;
    };

    const slots = Array.isArray(parsed.slots) ? parsed.slots : [];

    if (parsed.mode === "slots_v1" && slots.length > 0) {
      const safeDates = Array.isArray(parsed.dates) && parsed.dates.length > 0 ? parsed.dates : [new Date().toISOString()];

      return safeDates
        .flatMap((rawDate) => {
          const parsedDate = new Date(rawDate);
          if (Number.isNaN(parsedDate.getTime())) return [];

          return slots.map((slot) => {
            const timeRaw = String(slot.time || "").trim();
            const [hours, minutes] = /^\d{2}:\d{2}$/.test(timeRaw) ? timeRaw.split(":").map(Number) : [9, 0];
            const slotDate = new Date(parsedDate);
            slotDate.setHours(hours, minutes, 0, 0);

            return {
              dateLabel: slotDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
              timeLabel: slotDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
              methodLabel: slot.method === "google_meet" ? "Online" : "Face-to-Face",
            };
          });
        })
        .slice(0, 4);
    }
  } catch {
    return [];
  }

  return [];
};

export default function KioskScheduleDirectory() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedCollege, setSelectedCollege] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedFaculty, setSelectedFaculty] = useState("all");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FacultySchedule[]>([]);
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

  const loadDirectory = useCallback(async () => {
    setLoading(true);

    const { data, error } = await kioskSupabase
      .from("faculty")
      .select("id, name, consultation_method, schedule, status, department_id, department:departments(id, name, college_id, college:colleges(id, name))")
      .order("name");

    if (error) {
      console.error("Failed to load schedule directory:", error);
      setLoading(false);
      return;
    }

    setRows((data || []) as FacultySchedule[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDirectory();
    void loadLookups();

    const channel = kioskSupabase
      .channel("kiosk-schedule-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "faculty" }, () => void loadDirectory())
      .on("postgres_changes", { event: "*", schema: "public", table: "colleges" }, () => void loadLookups())
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () => void loadLookups())
      .subscribe();

    return () => {
      kioskSupabase.removeChannel(channel);
    };
  }, [loadDirectory, loadLookups]);

  const enrichedRows = useMemo(() => {
    return rows.map((row) => {
      const dept = getDepartmentValue(row.department);
      return {
        ...row,
        departmentName: dept.name,
        departmentId: dept.id,
        collegeName: dept.collegeName,
        collegeId: dept.collegeId,
      };
    });
  }, [rows]);

  const collegeOptions = useMemo(() => {
    const fromLookup = colleges.map((college) => ({
      id: college.id,
      name: college.code ? `${college.code} - ${college.name}` : college.name,
    }));

    const fallback = enrichedRows
      .filter((row) => !fromLookup.some((college) => college.id === row.collegeId))
      .map((row) => ({ id: row.collegeId, name: row.collegeName }));

    return [...fromLookup, ...fallback].sort((a, b) => a.name.localeCompare(b.name));
  }, [colleges, enrichedRows]);

  const departmentOptions = useMemo(() => {
    const lookupRows = departments.filter((department) => {
      if (selectedCollege === "all") return true;
      return department.college_id === selectedCollege;
    });

    const fromLookup = lookupRows.map((department) => ({ id: department.id, name: department.name }));

    const fallback = enrichedRows
      .filter((row) => {
        if (selectedCollege !== "all" && row.collegeId !== selectedCollege) return false;
        return !fromLookup.some((department) => department.id === row.departmentId);
      })
      .map((row) => ({ id: row.departmentId, name: row.departmentName }));

    return [...fromLookup, ...fallback].sort((a, b) => a.name.localeCompare(b.name));
  }, [departments, enrichedRows, selectedCollege]);

  const facultyOptions = useMemo(() => {
    return enrichedRows
      .filter((row) => {
        if (selectedCollege !== "all" && row.collegeId !== selectedCollege) return false;
        if (selectedDepartment !== "all" && row.departmentId !== selectedDepartment) return false;
        return true;
      })
      .map((row) => ({ id: row.id, name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [enrichedRows, selectedCollege, selectedDepartment]);

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

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return enrichedRows.filter((row) => {
      if (selectedCollege !== "all" && row.collegeId !== selectedCollege) return false;
      if (selectedDepartment !== "all" && row.departmentId !== selectedDepartment) return false;
      if (selectedFaculty !== "all" && row.id !== selectedFaculty) return false;

      if (!needle) return true;

      return (
        row.name.toLowerCase().includes(needle) ||
        row.departmentName.toLowerCase().includes(needle) ||
        row.collegeName.toLowerCase().includes(needle) ||
        methodLabel(row.consultation_method).toLowerCase().includes(needle)
      );
    });
  }, [enrichedRows, search, selectedCollege, selectedDepartment, selectedFaculty]);

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
              placeholder="Search professor, method, department, or college"
              className="pl-9 rounded-2xl border-[#d9dde2] bg-white"
            />
          </div>
        </div>

        <Card className="rounded-[28px] border-0 shadow-sm bg-white">
          <CardContent className="p-6 sm:p-7 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Clock3 className="text-[#c62828]" size={20} />
              <h1 className="text-2xl font-black tracking-tight text-[#024059]">Professor Availability Directory</h1>
            </div>
            <p className="text-sm text-[#024059]/70">Use dropdowns to view schedules per college, department, and faculty.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                value={selectedCollege}
                onValueChange={(value) => {
                  setSelectedCollege(value);
                  setSelectedDepartment("all");
                  setSelectedFaculty("all");
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

              <Select value={selectedFaculty} onValueChange={setSelectedFaculty}>
                <SelectTrigger className="rounded-xl bg-white"><SelectValue placeholder="Faculty" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">All Faculty</SelectItem>
                  {facultyOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loading && (
            <Card className="md:col-span-2 rounded-[24px] border-0 shadow-sm">
              <CardContent className="p-10 text-center text-[#024059]/65 text-sm font-bold uppercase tracking-wider">
                Loading schedules...
              </CardContent>
            </Card>
          )}

          {!loading && filteredRows.length === 0 && (
            <Card className="md:col-span-2 rounded-[24px] border-0 shadow-sm">
              <CardContent className="p-10 text-center text-[#024059]/65 text-sm font-bold uppercase tracking-wider">
                No schedule entries match your filters.
              </CardContent>
            </Card>
          )}

          {!loading &&
            filteredRows.map((row) => {
              const slotPreview = parseSchedule(row.schedule);

              return (
                <Card key={row.id} className="rounded-[24px] border-0 shadow-sm bg-white overflow-hidden">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-900 leading-tight">{row.name}</p>
                        <p className="text-xs font-bold uppercase tracking-wide text-[#024059]/60">{row.departmentName} - {row.collegeName}</p>
                      </div>
                      <Badge className="bg-[#eef4f8] text-[#024059] hover:bg-[#eef4f8] border-0 uppercase text-[10px] font-black tracking-wide">
                        {methodLabel(row.consultation_method)}
                      </Badge>
                    </div>

                    <div className="mt-4 rounded-2xl border border-[#e4e9ef] bg-[#f8fbfd] p-4">
                      <p className="text-[10px] uppercase font-black tracking-wider text-[#024059]/65 mb-2">Consultation Hours</p>

                      {slotPreview.length > 0 ? (
                        <div className="space-y-2">
                          {slotPreview.map((slot) => (
                            <div key={`${slot.dateLabel}-${slot.timeLabel}-${slot.methodLabel}`} className="flex items-center justify-between text-sm rounded-xl bg-white px-3 py-2 border border-[#ecf1f6]">
                              <span className="font-bold text-slate-800">{slot.dateLabel} - {slot.timeLabel}</span>
                              <span className="text-[11px] font-black uppercase tracking-wide text-[#024059]/70">{slot.methodLabel}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm font-bold text-[#024059]/65 whitespace-pre-line">
                          {row.schedule && row.schedule.trim().length > 0 ? row.schedule : "No posted consultation hours yet."}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 text-[11px] font-black uppercase tracking-wide text-[#c62828]">
                      {row.status === "accepting" ? "Currently accepting students" : "Currently unavailable"}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      </div>
    </div>
  );
}
