import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calendar,
  Clock,
  Globe,
  GraduationCap,
  Loader2,
  Monitor,
  ScanBarcode,
  Search,
  UserCheck,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

  const [currentTime, setCurrentTime] = useState(new Date());
  const [faculties, setFaculties] = useState<any[]>([]);
  const [colleges, setColleges] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string; college_id: string | null }>>([]);
  const [selectedMonitorCollege, setSelectedMonitorCollege] = useState<string>("all");
  const [selectedMonitorDepartment, setSelectedMonitorDepartment] = useState<string>("all");
  const [selectedMonitorProf, setSelectedMonitorProf] = useState<string | null>(null);
  const [liveQueue, setLiveQueue] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [queueFinderOpen, setQueueFinderOpen] = useState(false);
  const [queueFinderQuery, setQueueFinderQuery] = useState("");
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(false);
  const [pendingStudentNumber, setPendingStudentNumber] = useState<string | null>(null);
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [isResolvingStudent, setIsResolvingStudent] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardField, setKeyboardField] = useState<"studentNumber" | "studentName" | "studentEmail" | "directorySearch" | null>(null);

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

  const openKeyboardFor = (field: "studentNumber" | "studentName" | "studentEmail" | "directorySearch") => {
    if (!shouldUseOnScreenKeyboard) return;
    setKeyboardField(field);
    setKeyboardVisible(true);
  };

  const getKeyboardValue = () => {
    if (keyboardField === "studentNumber") return studentNumber;
    if (keyboardField === "studentName") return studentName;
    if (keyboardField === "studentEmail") return studentEmail;
    if (keyboardField === "directorySearch") return searchQuery;
    return "";
  };

  const updateKeyboardValue = (next: string) => {
    if (keyboardField === "studentNumber") setStudentNumber(next.toUpperCase());
    if (keyboardField === "studentName") setStudentName(next);
    if (keyboardField === "studentEmail") setStudentEmail(next.toLowerCase());
    if (keyboardField === "directorySearch") setSearchQuery(next);
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

  const handleCheckStatus = async () => {
    setQueueFinderQuery("");
    setQueueFinderOpen(true);
  };

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
  const availableFaculties = faculties.filter((f) => f.status === "accepting");
  const filteredFaculties = availableFaculties.filter((f) => {
    const normalized = searchQuery.toLowerCase();
    return (
      f.name.toLowerCase().includes(normalized) ||
      (f.department?.name || "").toLowerCase().includes(normalized)
    );
  });

  const meetingMethod = selectedFaculty?.consultation_method || "face_to_face";
  const isOnline = meetingMethod === "online";

  const queueFinderRows = liveQueue.filter((ticket) => {
    const needle = queueFinderQuery.trim().toLowerCase();
    if (!needle) return true;

    const candidateName = String(ticket.student_display_name || "").toLowerCase();
    const candidateStudentNumber = String(ticket.student_number || "").toLowerCase();
    return candidateName.includes(needle) || candidateStudentNumber.includes(needle);
  });

  const getRemainingTime = (calledAt: string | null) => {
    if (!calledAt) return 15;
    const start = new Date(calledAt).getTime();
    const end = start + 15 * 60 * 1000;
    return Math.max(0, Math.floor((end - currentTime.getTime()) / 60000));
  };

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
      <header className="bg-white border-b border-[#E8E6EB] px-4 py-4 sm:px-8 sticky top-0 z-30 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#c62828] rounded-xl flex items-center justify-center shadow-md text-white font-black text-xs">EQ</div>
          <h1 className="text-xl font-black text-[#c62828] uppercase tracking-tight">EARIST Kiosk</h1>
        </div>
        <div className="text-right">
          <p className="text-sm font-black text-slate-800 leading-none">{formattedTime}</p>
          <p className="text-[10px] font-black text-[#c62828]/60 uppercase tracking-wide mt-1">{formattedDate}</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-4 py-6 sm:px-8 sm:py-10 flex flex-col lg:flex-row gap-6 sm:gap-8">
        <div className="lg:w-[58%]">
          <Card className="border-0 shadow-2xl rounded-[48px] overflow-hidden bg-white">
            <div className="p-7 text-center sm:p-10 border-b border-[#f1e5e5]">
              <h2 className="text-3xl font-black uppercase leading-none tracking-tighter sm:text-4xl text-[#c62828]">Student Registration</h2>
              <p className="text-[#c62828] mt-3 text-sm font-black uppercase tracking-widest">Scan Student ID to Book Consultation</p>
            </div>

            <CardContent className="p-8 sm:p-10 space-y-5">
              <div className="w-full p-8 rounded-[36px] bg-[#fff5f5] border-2 border-dashed border-[#f1c4c4] flex flex-col items-center justify-center min-h-56 text-center">
                <ScanBarcode className="w-16 h-16 text-[#c62828] mb-4" />
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
                  onFocus={() => openKeyboardFor("studentNumber")}
                  disabled={loading}
                  className="text-center font-mono h-14 border-slate-200 focus-visible:ring-4 focus-visible:ring-[#f1c4c4] focus-visible:border-[#c62828] rounded-[20px] text-lg bg-slate-50 font-bold"
                />

                <Button
                  type="submit"
                  className="w-full bg-[#c62828] hover:bg-[#b22222] text-white font-black h-16 text-base rounded-[28px] shadow-xl transition-all uppercase tracking-[0.1em]"
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

                  <DialogFooter className="p-6 pt-0 grid grid-cols-2 gap-3">
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

              <div className="grid grid-cols-2 gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCheckStatus}
                  className="rounded-xl h-12 text-[10px] font-black uppercase tracking-widest border-slate-200"
                >
                  Check Status
                </Button>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl h-12 text-[10px] font-black uppercase tracking-widest border-slate-200"
                    >
                      Directory
                    </Button>
                  </DialogTrigger>

                  <DialogContent className="rounded-[40px] max-w-2xl border-0 shadow-2xl p-0 overflow-hidden bg-white">
                    <DialogHeader className="bg-[#c62828] p-8 text-white relative">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-bl-full -mr-8 -mt-8" />
                      <div className="flex justify-between items-center relative z-10">
                        <div>
                          <DialogTitle className="text-3xl font-black uppercase tracking-tighter">
                            Faculty Directory
                          </DialogTitle>
                          <p className="text-[#E8E6EB] text-xs opacity-80 uppercase tracking-widest font-bold mt-1">
                            Live Availability
                          </p>
                        </div>
                        <GraduationCap className="text-white/20 w-14 h-14" />
                      </div>

                      <div className="mt-8 relative z-10">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 w-4 h-4" />
                        <input
                          type="text"
                          placeholder="Search professor or department..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onFocus={() => openKeyboardFor("directorySearch")}
                          className="w-full bg-white/10 border border-white/20 rounded-2xl py-4 pl-12 pr-6 text-white placeholder:text-white/40 focus:outline-none focus:ring-4 focus:ring-white/10 transition-all font-bold"
                        />
                      </div>
                    </DialogHeader>

                    <div className="p-8 space-y-4 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                      {filteredFaculties.length > 0 ? (
                        filteredFaculties.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-100"
                          >
                            <div className="flex items-center gap-5">
                              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-[#c62828] font-black text-xl shadow-sm uppercase border border-[#E8E6EB]">
                                {f.name[0]}
                              </div>
                              <div>
                                <p className="font-black text-slate-800 text-lg leading-tight">{f.name}</p>
                                <p className="text-[10px] font-bold text-[#c62828]/65 uppercase tracking-[0.2em] mt-1">
                                  {f.department?.name || "Faculty Member"}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 bg-[#f3f1f6]/60 text-[#c62828] px-4 py-2 rounded-xl border border-[#E8E6EB] shadow-sm">
                              <div className="w-2 h-2 rounded-full bg-[#c62828] animate-pulse" />
                              <span className="text-[10px] font-black uppercase tracking-wider">Active</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-16">
                          <Building2 className="w-16 h-16 text-slate-100 mx-auto mb-4" />
                          <p className="text-[#c62828]/65 font-bold uppercase tracking-widest text-[10px]">
                            No active professors matching your search
                          </p>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>

                <Dialog open={queueFinderOpen} onOpenChange={setQueueFinderOpen}>
                  <DialogContent className="rounded-[32px] max-w-2xl border-0 shadow-2xl p-0 overflow-hidden bg-white">
                    <DialogHeader className="bg-[#c62828] p-6 text-white">
                      <DialogTitle className="text-2xl font-black uppercase tracking-tight">
                        Find Student Queue
                      </DialogTitle>
                      <p className="text-[11px] text-[#E8E6EB] font-bold uppercase tracking-wider mt-2">
                        Search by student number or name, then open status
                      </p>
                    </DialogHeader>

                    <div className="p-6 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Select
                          value={selectedMonitorCollege}
                          onValueChange={(value) => {
                            setSelectedMonitorCollege(value);
                            setSelectedMonitorDepartment("all");
                          }}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 h-11 text-xs font-black uppercase tracking-wide">
                            <SelectValue placeholder="Select College" />
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

                        <Select
                          value={selectedMonitorDepartment}
                          onValueChange={(value) => setSelectedMonitorDepartment(value)}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 h-11 text-xs font-black uppercase tracking-wide">
                            <SelectValue placeholder="Select Department" />
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

                        <Select
                          value={selectedMonitorProf || ""}
                          onValueChange={(value) => setSelectedMonitorProf(value)}
                          disabled={monitorFaculties.length === 0}
                        >
                          <SelectTrigger className="rounded-xl border-slate-200 h-11 text-xs font-black uppercase tracking-wide">
                            <SelectValue placeholder="Select Professor" />
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

                      <Input
                        placeholder="Type student number or student name"
                        value={queueFinderQuery}
                        onChange={(event) => setQueueFinderQuery(event.target.value)}
                        className="h-12 rounded-xl border-slate-200 font-bold"
                      />

                      <div className="max-h-[46vh] overflow-y-auto pr-1 space-y-2">
                        {queueFinderRows.length > 0 ? (
                          queueFinderRows.map((ticket) => (
                            <button
                              key={ticket.id}
                              type="button"
                              onClick={() => {
                                setQueueFinderOpen(false);
                                setLocation(`/status/${ticket.id}`);
                              }}
                              className="w-full text-left rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 hover:border-[#c62828] hover:bg-white transition-colors"
                            >
                              <p className="text-sm font-black text-slate-900">{ticket.student_display_name || "Unknown Student"}</p>
                              <p className="text-[11px] font-bold uppercase tracking-wide text-[#c62828]/70 mt-1">
                                {ticket.student_number || "No Student Number"} • {ticket.status === "called" ? "In Session" : "Waiting"}
                              </p>
                            </button>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
                            <p className="text-[10px] font-black uppercase tracking-widest text-[#c62828]/65">
                              No active students match your search
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:w-[42%] grid grid-cols-1 gap-6">
          <Card className="border-0 shadow-xl rounded-[40px] bg-white overflow-hidden">
            <CardContent className="p-6 sm:p-7 h-full flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#c62828]/70">Live Monitor</p>
                <Monitor size={20} className="text-[#c62828]" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#c62828]/65 mb-1.5">
                    College
                  </p>
                  <Select
                    value={selectedMonitorCollege}
                    onValueChange={(value) => {
                      setSelectedMonitorCollege(value);
                      setSelectedMonitorDepartment("all");
                    }}
                  >
                    <SelectTrigger className="rounded-xl border-slate-200 h-11 text-xs font-black uppercase tracking-wide">
                      <SelectValue placeholder="Select College" />
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
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#c62828]/65 mb-1.5">
                    Department
                  </p>
                  <Select
                    value={selectedMonitorDepartment}
                    onValueChange={(value) => setSelectedMonitorDepartment(value)}
                  >
                    <SelectTrigger className="rounded-xl border-slate-200 h-11 text-xs font-black uppercase tracking-wide">
                      <SelectValue placeholder="Select Department" />
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
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#c62828]/65 mb-1.5">
                    Professor
                  </p>
                  <Select
                    value={selectedMonitorProf || ""}
                    onValueChange={(value) => setSelectedMonitorProf(value)}
                    disabled={monitorFaculties.length === 0}
                  >
                    <SelectTrigger className="rounded-xl border-slate-200 h-11 text-xs font-black uppercase tracking-wide">
                      <SelectValue placeholder="Select Professor" />
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

              <div className="rounded-2xl border border-[#e4e9ef] bg-[#f8fbfd] p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#c62828]/65 mb-1">In Session</p>
                <p className="text-lg font-black text-slate-900">{currentServing ? currentServing.student_display_name : "No active consultation"}</p>
                <p className="text-[10px] font-black text-[#c62828]/60 uppercase tracking-wide mt-1">{selectedFaculty?.name || "No assigned faculty"}</p>
              </div>

              <div className="rounded-2xl bg-[#f5f8fa] border border-[#e6edf2] px-4 py-3 flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-widest text-[#c62828]/70">Waiting</span>
                <span className="text-xl font-black text-[#c62828]">{waitingQueue.length}</span>
              </div>

              <p className="text-[10px] font-black uppercase tracking-wider text-[#c62828]">Tap "Check Status" to find students quickly</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl rounded-[40px] bg-white overflow-hidden">
            <CardContent className="p-6 sm:p-7 h-full flex flex-col justify-between">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#c62828]/70">Prof Schedules</p>
                <Calendar size={20} className="text-[#c62828]" />
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 mb-3">
                <p className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest mb-2">
                  Selected Professor
                </p>
                <p className="text-lg font-black text-slate-800">
                  {selectedFaculty?.name || "No professor selected"}
                </p>
                <p className="text-[10px] font-bold text-[#c62828]/65 uppercase tracking-widest mt-1">
                  {selectedFaculty?.department?.name || "Department unavailable"}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 mb-3">
                <p className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest mb-3">
                  Consultation Hours
                </p>
                <p className="text-sm font-black text-slate-700 whitespace-pre-line">
                  {selectedFaculty?.schedule || "No official hours posted yet."}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 mb-3">
                <p className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest mb-3">
                  Meeting Preference
                </p>
                <div className="flex items-center gap-3">
                  {isOnline ? (
                    <Globe size={20} className="text-[#c62828]" />
                  ) : (
                    <UserCheck size={20} className="text-[#c62828]" />
                  )}
                  <span className="text-sm font-black text-slate-800 uppercase tracking-wider">
                    {meetingMethod.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-[9px] font-bold text-[#c62828]/65 mt-3 uppercase tracking-widest">
                  {isOnline
                    ? "A Google Meet link will be shared by your professor."
                    : "Please proceed to the faculty office for consultation."}
                </p>
              </div>

              <p className="text-[10px] font-black uppercase tracking-wider text-[#c62828]">Use filters above for faculty-by-faculty lookup</p>
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

      <footer className="px-4 py-6 sm:px-8 flex flex-col sm:flex-row justify-between items-center gap-3 bg-white border-t border-slate-100">
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

