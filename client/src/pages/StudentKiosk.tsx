import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Globe,
  Loader2,
  Monitor,
  ScanBarcode,
  UserCheck,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { kioskSupabase } from "@/lib/supabaseKiosk";
import { toast } from "react-hot-toast";
import { barcodeService } from "@/services/BarcodeService";
import { OnScreenKeyboard } from "@/components/OnScreenKeyboard";

export default function StudentKiosk() {
  const [, setLocation] = useLocation();
  const [studentNumber, setStudentNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scanLockRef = useRef(false);
  const autoPromptedStudentRef = useRef<string>("");

  const [currentTime, setCurrentTime] = useState(new Date());
  const [faculties, setFaculties] = useState<any[]>([]);
  const [colleges, setColleges] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string; college_id: string | null }>>([]);
  const [selectedMonitorCollege, setSelectedMonitorCollege] = useState<string>("all");
  const [selectedMonitorDepartment, setSelectedMonitorDepartment] = useState<string>("all");
  const [selectedMonitorProf, setSelectedMonitorProf] = useState<string | null>(null);
  const [liveQueue, setLiveQueue] = useState<any[]>([]);
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(false);
  const [pendingStudentNumber, setPendingStudentNumber] = useState<string | null>(null);
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [isResolvingStudent, setIsResolvingStudent] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardField, setKeyboardField] = useState<"studentNumber" | "studentName" | "studentEmail" | null>(null);

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

  const shouldUseOnScreenKeyboard =
    typeof window !== "undefined" &&
    !/android|iphone|ipad|ipod|mobile/i.test(window.navigator.userAgent || "") &&
    window.matchMedia("(pointer: coarse)").matches;

  const openKeyboardFor = (field: "studentNumber" | "studentName" | "studentEmail") => {
    if (!shouldUseOnScreenKeyboard) return;
    setKeyboardField(field);
    setKeyboardVisible(true);
  };

  const getKeyboardValue = () => {
    if (keyboardField === "studentNumber") return studentNumber;
    if (keyboardField === "studentName") return studentName;
    if (keyboardField === "studentEmail") return studentEmail;
    return "";
  };

  const updateKeyboardValue = (next: string) => {
    if (keyboardField === "studentNumber") setStudentNumber(next.toUpperCase());
    if (keyboardField === "studentName") setStudentName(next);
    if (keyboardField === "studentEmail") setStudentEmail(next.toLowerCase());
  };

  const keyboardMode = keyboardField === "studentEmail" ? "email" : keyboardField === "studentName" ? "text" : "alphanumeric";

  const loadFaculties = useCallback(async () => {
    const { data, error: fetchError } = await kioskSupabase
      .from("faculty")
      .select("*, department:departments(name)")
      .order("name");

    if (fetchError) {
      console.error("Failed to load faculty:", fetchError);
      return;
    }

    const facultyList = data || [];
    setFaculties(facultyList);
    setSelectedMonitorProf((prev) => {
      if (prev && facultyList.some((row) => row.id === prev)) return prev;
      return facultyList.length > 0 ? facultyList[0].id : null;
    });
  }, []);

  const loadQueueForFaculty = useCallback(async (facultyId: string) => {
    const { data, error: fetchError } = await kioskSupabase
      .from("queue_entries")
      .select("*")
      .eq("faculty_id", facultyId)
      .in("status", ["waiting", "called"])
      .order("created_at", { ascending: true });

    if (fetchError) {
      console.error("Failed to load queue monitor:", fetchError);
      return;
    }

    const queueEntries = data || [];
    if (queueEntries.length === 0) {
      setLiveQueue([]);
      return;
    }

    const queueEntryIds = queueEntries.map((entry) => entry.id);
    let displayNameByQueueEntryId: Record<string, string> = {};

    if (queueEntryIds.length > 0) {
      const { data: identityRows, error: identityLookupError } = await kioskSupabase
        .from("queue_history")
        .select("queue_entry_id, notes, created_at")
        .in("queue_entry_id", queueEntryIds)
        .eq("action", "student_identified")
        .order("created_at", { ascending: false });

      if (identityLookupError) {
        console.error("Failed to resolve student identity from history:", identityLookupError);
      } else if (identityRows) {
        displayNameByQueueEntryId = identityRows.reduce((acc, row) => {
          if (!acc[row.queue_entry_id] && row.notes) {
            acc[row.queue_entry_id] = row.notes;
          }
          return acc;
        }, {} as Record<string, string>);
      }
    }

    const studentNumbers = Array.from(
      new Set(
        queueEntries
          .map((entry) => normalizeStudentNumber(entry.student_number || ""))
          .filter(Boolean),
      ),
    );

    let displayNameByStudentNumber: Record<string, string> = {};
    if (studentNumbers.length > 0) {
      const { data: studentRows, error: studentLookupError } = await kioskSupabase
        .from("students")
        .select("*")
        .in("student_number", studentNumbers);

      if (studentLookupError) {
        console.error("Failed to resolve student names for monitor:", studentLookupError);
      } else if (studentRows) {
        displayNameByStudentNumber = studentRows.reduce((acc, row) => {
          const key = normalizeStudentNumber((row as any).student_number || "");
          const resolvedName =
            String((row as any).full_name || "").trim() ||
            String((row as any).student_name || "").trim() ||
            String((row as any).name || "").trim();

          if (key && resolvedName) acc[key] = resolvedName;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    const queueWithDisplayName = queueEntries.map((entry) => {
      const key = normalizeStudentNumber(entry.student_number || "");
      return {
        ...entry,
        student_display_name:
          displayNameByQueueEntryId[entry.id] ||
          displayNameByStudentNumber[key] ||
          maskStudentNumber(entry.student_number || ""),
      };
    });

    setLiveQueue(queueWithDisplayName);
  }, []);

  useEffect(() => {
    loadFaculties();
    const channel = kioskSupabase
      .channel("student-kiosk-faculty-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "faculty" }, () => loadFaculties())
      .subscribe();

    return () => {
      kioskSupabase.removeChannel(channel);
    };
  }, [loadFaculties]);

  useEffect(() => {
    const loadLookups = async () => {
      const [collegesRes, departmentsRes] = await Promise.all([
        kioskSupabase.from("colleges").select("id, name, code").order("name"),
        kioskSupabase.from("departments").select("id, name, college_id").order("name"),
      ]);

      if (!collegesRes.error) {
        setColleges((collegesRes.data || []) as Array<{ id: string; name: string; code: string }>);
      }

      if (!departmentsRes.error) {
        setDepartments((departmentsRes.data || []) as Array<{ id: string; name: string; college_id: string | null }>);
      }
    };

    void loadLookups();
  }, []);

  useEffect(() => {
    if (!selectedMonitorProf) {
      setLiveQueue([]);
      return;
    }

    loadQueueForFaculty(selectedMonitorProf);

    const channel = kioskSupabase
      .channel(`student-kiosk-queue-monitor:${selectedMonitorProf}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_entries",
          filter: `faculty_id=eq.${selectedMonitorProf}`,
        },
        () => loadQueueForFaculty(selectedMonitorProf),
      )
      .subscribe();

    return () => {
      kioskSupabase.removeChannel(channel);
    };
  }, [selectedMonitorProf, loadQueueForFaculty]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const validDepartmentIds = selectedMonitorCollege === "all"
      ? null
      : new Set(
          departments
            .filter((department) => department.college_id === selectedMonitorCollege)
            .map((department) => department.id),
        );

    const monitorFaculties = faculties.filter((faculty) => {
      if (validDepartmentIds && !validDepartmentIds.has(faculty.department_id)) return false;
      if (selectedMonitorDepartment === "all") return true;
      return faculty.department_id === selectedMonitorDepartment;
    });

    setSelectedMonitorProf((prev) => {
      if (prev && monitorFaculties.some((faculty) => faculty.id === prev)) return prev;
      return monitorFaculties.length > 0 ? monitorFaculties[0].id : null;
    });
  }, [selectedMonitorCollege, selectedMonitorDepartment, faculties, departments]);

  useEffect(() => {
    if (selectedMonitorDepartment === "all") return;
    const selectedDepartment = departments.find((department) => department.id === selectedMonitorDepartment);
    if (!selectedDepartment) {
      setSelectedMonitorDepartment("all");
      return;
    }

    if (selectedMonitorCollege !== "all" && selectedDepartment.college_id !== selectedMonitorCollege) {
      setSelectedMonitorDepartment("all");
    }
  }, [selectedMonitorCollege, selectedMonitorDepartment, departments]);

  const validateStudentNumber = (number: string): boolean => {
    const pattern = /^\d{3}-\d{5}[A-Z]?$/;
    return pattern.test(number);
  };

  const validateEmail = (email: string): boolean => {
    const candidate = email.trim();
    if (!candidate) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate);
  };

  const openStudentIdentityDialog = async (studentId: string) => {
    const normalized = studentId.trim().toUpperCase();
    setPendingStudentNumber(normalized);
    setStudentName("");
    setStudentEmail("");
    setIsNameDialogOpen(true);
    setIsResolvingStudent(true);

    try {
      const { data, error: lookupError } = await supabase
        .from("students")
        .select("*")
        .eq("student_number", normalized)
        .maybeSingle();

      if (!lookupError && data) {
        const resolvedName =
          (data as any).full_name ||
          (data as any).student_name ||
          (data as any).name ||
          "";
        if (resolvedName) setStudentName(String(resolvedName));

        const resolvedEmail =
          (data as any).email ||
          (data as any).student_email ||
          "";
        if (resolvedEmail) setStudentEmail(String(resolvedEmail));
      }
    } catch (lookupError) {
      console.error("Student lookup failed:", lookupError);
    } finally {
      setIsResolvingStudent(false);
    }
  };

  const processStudentEntry = useCallback(
    async (idToProcess: string, nameToProcess: string): Promise<boolean> => {
      if (scanLockRef.current) return false;
      scanLockRef.current = true;
      setLoading(true);
      setError(null);

      const normalizedId = idToProcess.trim().toUpperCase();
      const normalizedName = nameToProcess.trim();
      const normalizedEmail = studentEmail.trim().toLowerCase();
      const targetRoute = `/kiosk/booking?student=${encodeURIComponent(normalizedId)}&name=${encodeURIComponent(normalizedName)}&email=${encodeURIComponent(normalizedEmail)}`;

      try {
        void (async () => {
          try {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            if (!session?.user) return;

            const basePayload = {
              student_number: normalizedId,
              last_active: new Date().toISOString(),
            };

            if (normalizedName) {
              const { error: namedUpsertError } = await supabase.from("students").upsert(
                { ...basePayload, name: normalizedName, email: normalizedEmail },
                { onConflict: "student_number" },
              );

              if (namedUpsertError) {
                const { error: fallbackUpsertError } = await supabase
                  .from("students")
                  .upsert({ ...basePayload, email: normalizedEmail }, { onConflict: "student_number" });
                if (fallbackUpsertError && fallbackUpsertError.code !== "42501") {
                  console.error("Student upsert failed:", fallbackUpsertError);
                }
              }
            } else {
              const { error: upsertError } = await supabase
                .from("students")
                .upsert({ ...basePayload, email: normalizedEmail }, { onConflict: "student_number" });
              if (upsertError && upsertError.code !== "42501") {
                console.error("Student upsert failed:", upsertError);
              }
            }
          } catch (upsertErr) {
            console.error("Student session/upsert failed:", upsertErr);
          }
        })();

        setLocation(targetRoute);

        setTimeout(() => {
          if (!window.location.pathname.startsWith("/kiosk/booking")) {
            window.location.assign(targetRoute);
          }
        }, 150);

        setTimeout(() => {
          if (!window.location.pathname.startsWith("/kiosk/booking")) {
            scanLockRef.current = false;
            setLoading(false);
          }
        }, 2000);

        return true;
      } catch (processError: any) {
        setError(processError.message || "Connection error. Please try again.");
        setLoading(false);
        scanLockRef.current = false;
        return false;
      }
    },
    [setLocation, studentEmail],
  );

  const handleConfirmStudentIdentity = async () => {
    if (!pendingStudentNumber) return;
    if (!studentName.trim()) {
      toast.error("Please enter your full name.");
      return;
    }
    if (!validateEmail(studentEmail)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    toast.loading("ID Verified! Processing...", { id: "kiosk-scan" });
    const completed = await processStudentEntry(pendingStudentNumber, studentName.trim());

    if (completed) {
      setIsNameDialogOpen(false);
      setPendingStudentNumber(null);
      toast.success("Welcome Student!", { id: "kiosk-scan" });
    } else {
      toast.dismiss("kiosk-scan");
    }
  };

  useEffect(() => {
    const handleStudentScan = async (scannedCode: string) => {
      if (scanLockRef.current) return;

      const normalizedCode = scannedCode.trim().toUpperCase();
      if (!validateStudentNumber(normalizedCode)) {
        toast.error("Invalid EARIST ID format.");
        return;
      }

      setStudentNumber(normalizedCode);
      await openStudentIdentityDialog(normalizedCode);
    };

    barcodeService.setHandler(handleStudentScan);
    barcodeService.startListening();
    return () => barcodeService.stopListening();
  }, [processStudentEntry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scanLockRef.current) return;
    if (!studentNumber.trim()) {
      setError("Please scan or enter your ID");
      return;
    }
    if (!validateStudentNumber(studentNumber)) {      setError("Invalid format (e.g., 222-00000M)");
      return;
    }
    await openStudentIdentityDialog(studentNumber.trim().toUpperCase());
  };

  useEffect(() => {
    if (isNameDialogOpen || scanLockRef.current || loading) return;

    const normalized = studentNumber.trim().toUpperCase();
    if (!validateStudentNumber(normalized)) {
      autoPromptedStudentRef.current = "";
      return;
    }

    if (autoPromptedStudentRef.current === normalized) return;
    autoPromptedStudentRef.current = normalized;
    void openStudentIdentityDialog(normalized);
  }, [studentNumber, isNameDialogOpen, loading]);

  const departmentById = new Map(departments.map((department) => [department.id, department]));

  const monitorColleges = colleges.filter((college) =>
    departments.some((department) => department.college_id === college.id),
  );

  const monitorDepartments = Array.from(
    new Map(
      departments
        .filter((department) => selectedMonitorCollege === "all" || department.college_id === selectedMonitorCollege)
        .map((department) => [
          department.id,
          {
            id: department.id,
            name: department.name || "Unassigned Department",
          },
        ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const monitorFaculties = faculties.filter((faculty) => {
    if (selectedMonitorCollege !== "all") {
      const department = departmentById.get(faculty.department_id);
      if (!department || department.college_id !== selectedMonitorCollege) return false;
    }
    if (selectedMonitorDepartment === "all") return true;
    return faculty.department_id === selectedMonitorDepartment;
  });

  const selectedFaculty = faculties.find((f) => f.id === selectedMonitorProf);
  const currentServing = liveQueue.find((q) => q.status === "called");
  const waitingQueue = liveQueue.filter((q) => q.status === "waiting");

  const meetingMethod = selectedFaculty?.consultation_method || "face_to_face";
  const isOnline = meetingMethod === "online";

  const formattedDate = currentTime.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const formattedTime = currentTime.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`min-h-screen bg-[#f3f1f6] font-sans flex flex-col ${keyboardVisible ? "pb-64 md:pb-72" : ""}`}>
      <header className="bg-white border-b border-[#E8E6EB] px-4 py-3 sm:px-6 sticky top-0 z-30 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#c62828] rounded-xl flex items-center justify-center shadow-md text-white font-black text-xs">EQ</div>
          <h1 className="text-lg sm:text-xl font-black text-[#c62828] uppercase tracking-tight">EARIST Kiosk</h1>
        </div>
        <div className="text-right">
          <p className="text-sm font-black text-slate-800 leading-none">{formattedTime}</p>
          <p className="text-[10px] font-black text-[#c62828]/60 uppercase tracking-wide mt-1">{formattedDate}</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-3 py-4 sm:px-5 sm:py-5 flex flex-col lg:flex-row gap-4 sm:gap-5">
        <div className="lg:w-[58%]">
          <Card className="border-0 shadow-2xl rounded-[34px] overflow-hidden bg-white">
            <div className="p-5 text-center sm:p-6 border-b border-[#f1e5e5]">
              <h2 className="text-2xl font-black uppercase leading-none tracking-tight sm:text-3xl text-[#c62828]">Student Registration</h2>
              <p className="text-[#c62828] mt-2 text-xs sm:text-sm font-black uppercase tracking-wider">Scan Student ID to Book Consultation</p>
            </div>

            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="w-full p-6 rounded-[28px] bg-[#fff5f5] border-2 border-dashed border-[#f1c4c4] flex flex-col items-center justify-center min-h-44 text-center">
                <ScanBarcode className="w-12 h-12 sm:w-14 sm:h-14 text-[#c62828] mb-3" />
                <p className="text-[#7a3030] text-sm font-black uppercase tracking-wider">Present your school ID on the scanner.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive" className="bg-[#fff5f5] border-0 text-[#c62828] rounded-2xl p-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="font-bold text-xs">{error}</AlertDescription>
                  </Alert>
                )}

                <Input
                  type="text"
                  placeholder="Type student number (e.g., 222-00000M)"
                  value={studentNumber}
                  onChange={(e) => setStudentNumber(e.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSubmit(event as unknown as React.FormEvent);
                    }
                  }}
                  onFocus={() => openKeyboardFor("studentNumber")}
                  disabled={loading}
                  className="text-center font-mono h-12 sm:h-13 border-slate-200 focus-visible:ring-4 focus-visible:ring-[#f1c4c4] focus-visible:border-[#c62828] rounded-[16px] text-base sm:text-lg bg-slate-50 font-bold"
                />

                <Button
                  type="submit"
                  className="w-full bg-[#c62828] hover:bg-[#b22222] text-white font-black h-13 sm:h-14 text-sm sm:text-base rounded-[20px] shadow-xl transition-all uppercase tracking-[0.1em]"
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <>
                      Start Booking <ArrowRight size={18} className="ml-2" />
                    </>
                  )}
                </Button>
              </form>

              <Dialog
                open={isNameDialogOpen}
                onOpenChange={(open) => {
                  setIsNameDialogOpen(open);
                  if (!open) {
                    setPendingStudentNumber(null);
                    setStudentName("");
                    setStudentEmail("");
                    setIsResolvingStudent(false);
                    autoPromptedStudentRef.current = "";
                  }
                }}
              >
                <DialogContent className="rounded-3xl border-0 shadow-2xl p-0 overflow-hidden bg-white max-w-md">
                  <DialogHeader className="bg-[#c62828] text-white p-6">
                    <DialogTitle className="text-2xl font-black uppercase tracking-tight">
                      Confirm Identity
                    </DialogTitle>
                    <p className="text-[11px] text-[#E8E6EB] font-bold uppercase tracking-wider mt-2">
                      Student ID is protected
                    </p>
                  </DialogHeader>

                  <div className="p-6 space-y-4">
                    <div className="rounded-2xl bg-[#f3f1f6]/60 border border-[#E8E6EB] p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Student ID
                      </p>
                      <p className="text-lg font-black text-[#c62828]">
                        {pendingStudentNumber ? maskStudentNumber(pendingStudentNumber) : "-"}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">
                        Student Full Name
                      </label>
                      <Input
                        value={studentName}
                        onChange={(e) => setStudentName(e.target.value)}
                        onFocus={() => openKeyboardFor("studentName")}
                        placeholder={isResolvingStudent ? "Looking up student..." : "Enter your full name"}
                        disabled={loading || isResolvingStudent}
                        className="h-12 rounded-xl border-slate-200 font-bold"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">
                        Student Email (Required)
                      </label>
                      <Input
                        type="email"
                        value={studentEmail}
                        onChange={(e) => setStudentEmail(e.target.value)}
                        onFocus={() => openKeyboardFor("studentEmail")}
                        placeholder="name@earist.edu.ph"
                        disabled={loading || isResolvingStudent}
                        className="h-12 rounded-xl border-slate-200 font-bold"
                      />
                    </div>
                  </div>

                  <DialogFooter className="p-6 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsNameDialogOpen(false)}
                      disabled={loading}
                      className="w-full rounded-xl h-12 text-[10px] font-black uppercase tracking-widest"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={handleConfirmStudentIdentity}
                      disabled={loading || isResolvingStudent}
                      className="w-full rounded-xl h-12 bg-[#c62828] hover:bg-[#c62828] text-white text-[10px] font-black uppercase tracking-widest"
                    >
                      Continue
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>

        <div className="lg:w-[42%] flex flex-col gap-3">
          <Card className="border-0 shadow-xl rounded-[24px] bg-white overflow-hidden">
            <CardContent className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#c62828]/75">Live Monitor</p>
                <Monitor size={18} className="text-[#c62828]" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-widest text-[#c62828]/60 mb-1">College</p>
                  <Select
                    value={selectedMonitorCollege}
                    onValueChange={(value) => {
                      setSelectedMonitorCollege(value);
                      setSelectedMonitorDepartment("all");
                    }}
                  >
                    <SelectTrigger className="h-8 rounded-lg border-slate-200 text-[9px] font-black uppercase tracking-wide">
                      <SelectValue placeholder="College" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Colleges</SelectItem>
                      {monitorColleges.map((college) => (
                        <SelectItem key={college.id} value={college.id}>
                          {college.code} - {college.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-[8px] font-black uppercase tracking-widest text-[#c62828]/60 mb-1">Dept</p>
                  <Select
                    value={selectedMonitorDepartment}
                    onValueChange={(value) => setSelectedMonitorDepartment(value)}
                  >
                    <SelectTrigger className="h-8 rounded-lg border-slate-200 text-[9px] font-black uppercase tracking-wide">
                      <SelectValue placeholder="Department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {monitorDepartments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-[8px] font-black uppercase tracking-widest text-[#c62828]/60 mb-1">Prof</p>
                  <Select
                    value={selectedMonitorProf || ""}
                    onValueChange={(value) => setSelectedMonitorProf(value)}
                    disabled={monitorFaculties.length === 0}
                  >
                    <SelectTrigger className="h-8 rounded-lg border-slate-200 text-[9px] font-black uppercase tracking-wide">
                      <SelectValue placeholder="Professor" />
                    </SelectTrigger>
                    <SelectContent>
                      {monitorFaculties.map((faculty) => (
                        <SelectItem key={faculty.id} value={faculty.id}>
                          {faculty.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-[11px] font-black text-slate-800 leading-tight break-words">
                {selectedFaculty?.name || "No professor selected"}
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-[#e6ebf0] bg-[#f8fbfd] px-3 py-2 flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase tracking-wider text-[#c62828]/70">In Session</span>
                  <span className="text-[10px] font-black text-slate-800">{currentServing ? "1" : "0"}</span>
                </div>
                <div className="rounded-lg border border-[#e6ebf0] bg-[#f8fbfd] px-3 py-2 flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase tracking-wider text-[#c62828]/70">Waiting</span>
                  <span className="text-[10px] font-black text-slate-800">{waitingQueue.length}</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/kiosk/monitor")}
                className="w-full h-9 rounded-xl border-[#c62828]/30 text-[#c62828] hover:bg-[#fff5f5] font-black text-[10px] uppercase tracking-[0.14em]"
              >
                Open Live Monitor <ArrowRight size={14} className="ml-1" />
              </Button>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl rounded-[24px] bg-white overflow-hidden">
            <CardContent className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#c62828]/75">Prof Schedules</p>
                <Calendar size={18} className="text-[#c62828]" />
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <p className="text-[8px] font-black uppercase tracking-widest text-[#c62828]/65">Professor</p>
                <p className="text-[13px] sm:text-sm font-black text-slate-900 leading-snug break-words mt-1">
                  {selectedFaculty?.name || "No professor selected"}
                </p>
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#c62828]/65 mt-1">
                  {selectedFaculty?.department?.name || "Department unavailable"}
                </p>
              </div>

              <div className="rounded-lg border border-[#e6ebf0] bg-[#f8fbfd] px-3 py-2 flex items-center gap-2 text-[#c62828]">
                {isOnline ? <Globe size={14} /> : <UserCheck size={14} />}
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-700">
                  {meetingMethod.replace(/_/g, " ")}
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/kiosk/schedules")}
                className="w-full h-9 rounded-xl border-[#c62828]/30 text-[#c62828] hover:bg-[#fff5f5] font-black text-[10px] uppercase tracking-[0.14em]"
              >
                Open Schedule Directory <ArrowRight size={14} className="ml-1" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      {keyboardVisible && keyboardField && (
        <OnScreenKeyboard
          title="Kiosk Keyboard"
          value={getKeyboardValue()}
          onChange={updateKeyboardValue}
          onEnter={() => setKeyboardVisible(false)}
          onClose={() => setKeyboardVisible(false)}
          mode={keyboardMode}
          forceUppercase={keyboardField === "studentNumber"}
        />
      )}

      <footer className="px-4 py-3 sm:px-6 flex flex-col sm:flex-row justify-between items-center gap-2 bg-white border-t border-slate-100">
        <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.34em] text-center sm:text-left">
          EARIST QUEUE SYSTEM (C) 2026
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setLocation("/login")}
          className="h-10 px-4 rounded-xl border-[#c62828]/30 text-[#c62828] bg-white hover:bg-[#fff5f5] font-black text-[10px] uppercase tracking-[0.18em]"
        >
          Staff Login
        </Button>
      </footer>
    </div>
  );
}

