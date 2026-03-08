import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { kioskSupabase } from "@/lib/supabaseKiosk";
import { ChevronLeft, Clock3, Search } from "lucide-react";

type FacultySchedule = {
  id: string;
  name: string;
  consultation_method: string | null;
  schedule: string | null;
  status: string | null;
  department: { name: string } | { name: string }[] | null;
};

type ParsedSlot = {
  dateLabel: string;
  timeLabel: string;
  methodLabel: string;
};

const getDepartmentName = (department: FacultySchedule["department"]) => {
  if (!department) return "No department";
  if (Array.isArray(department)) return department[0]?.name || "No department";
  return department.name || "No department";
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
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FacultySchedule[]>([]);

  const loadDirectory = useCallback(async () => {
    setLoading(true);

    const { data, error } = await kioskSupabase
      .from("faculty")
      .select("id, name, consultation_method, schedule, status, department:departments(name)")
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

    const channel = kioskSupabase
      .channel("kiosk-schedule-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "faculty" }, () => void loadDirectory())
      .subscribe();

    return () => {
      kioskSupabase.removeChannel(channel);
    };
  }, [loadDirectory]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) => {
      return (
        row.name.toLowerCase().includes(needle) ||
        getDepartmentName(row.department).toLowerCase().includes(needle) ||
        methodLabel(row.consultation_method).toLowerCase().includes(needle)
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
              placeholder="Search professor, method, or department"
              className="pl-9 rounded-2xl border-[#d9dde2] bg-white"
            />
          </div>
        </div>

        <Card className="rounded-[28px] border-0 shadow-sm bg-white">
          <CardContent className="p-6 sm:p-7">
            <div className="flex items-center gap-3 mb-2">
              <Clock3 className="text-[#c62828]" size={20} />
              <h1 className="text-2xl font-black tracking-tight text-[#024059]">Professor Availability Directory</h1>
            </div>
            <p className="text-sm text-[#024059]/70">View consultation hours and meeting method per faculty member.</p>
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
                No schedule entries match your search.
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
                        <p className="text-xs font-bold uppercase tracking-wide text-[#024059]/60">{getDepartmentName(row.department)}</p>
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
                              <span className="font-bold text-slate-800">{slot.dateLabel} • {slot.timeLabel}</span>
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
