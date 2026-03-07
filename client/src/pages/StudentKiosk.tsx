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
  const [selectedMonitorDepartment, setSelectedMonitorDepartment] = useState<string>("all");
  const [selectedMonitorProf, setSelectedMonitorProf] = useState<string | null>(null);
  const [liveQueue, setLiveQueue] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
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
    const monitorFaculties = faculties.filter((faculty) => {
      if (selectedMonitorDepartment === "all") return true;
      return faculty.department_id === selectedMonitorDepartment;
    });

    setSelectedMonitorProf((prev) => {
      if (prev && monitorFaculties.some((faculty) => faculty.id === prev)) return prev;
      return monitorFaculties.length > 0 ? monitorFaculties[0].id : null;
    });
  }, [selectedMonitorDepartment, faculties]);

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
    const input = prompt("Enter your Student Number or Ticket ID:");
    if (!input || input.trim() === "") return;

    const cleanInput = input.trim();
    const toastId = toast.loading("Searching for active session...");

    try {
      const { data, error: queryError } = await kioskSupabase
        .from("queue_entries")
        .select("id")
        .or(`id.eq.${cleanInput},student_number.eq.${cleanInput.toUpperCase()}`)
        .in("status", ["waiting", "called"])
        .order("created_at", { ascending: false })
        .maybeSingle();

      if (queryError) throw queryError;

      if (!data) {
        toast.error("No active session found. Please book first.", { id: toastId });
      } else {
        toast.success("Active session found!", { id: toastId });
        setLocation(`/status/${data.id}`);
      }
    } catch (lookupError) {
      console.error(lookupError);
      toast.error("Error connecting to system. Please try again.", { id: toastId });
    }
  };

  const monitorDepartments = Array.from(
    new Map(
      faculties
        .filter((faculty) => !!faculty.department_id)
        .map((faculty) => [
          faculty.department_id,
          {
            id: faculty.department_id,
            name: faculty.department?.name || "Unassigned Department",
          },
        ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const monitorFaculties = faculties.filter((faculty) => {
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
    <div className={`min-h-screen bg-[#E8E6EB] flex flex-col font-sans ${keyboardVisible ? "pb-64 md:pb-72" : ""}`}>
      <header className="px-8 py-8 lg:px-12 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#024059] rounded-xl flex items-center justify-center shadow-lg shadow-[#024059]/20">
            <span className="text-white font-black text-xs">EQ</span>
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none uppercase text-[#024059]">
              EARIST Kiosk
            </h1>
            <p className="text-[#024059]/65 font-bold text-[10px] uppercase tracking-widest mt-1">
              Consultation Management
            </p>
          </div>
        </div>

        <div className="bg-white px-6 py-3 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-6">
          <div className="text-right">
            <div className="text-xl font-black text-slate-800 tracking-tight leading-none">
              {formattedTime}
            </div>
            <div className="text-[10px] font-bold text-[#024059]/65 uppercase mt-1">{formattedDate}</div>
          </div>
          <div className="h-8 w-px bg-slate-100" />
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[#024059] animate-pulse" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Active</span>
          </div>
        </div>
      </header>

      <main className="flex-1 px-8 pb-10 lg:px-12">
        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-3 gap-8">
          <Card className="border-0 shadow-[0_30px_60px_rgba(0,0,0,0.08)] rounded-[40px] overflow-hidden bg-white">
            <div className="bg-[#024059] pt-12 pb-8 px-8 text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-bl-full -mr-8 -mt-8" />
              <h2 className="text-3xl font-black text-white relative z-10 tracking-tight uppercase">
                Student Kiosk
              </h2>
              <p className="text-[#E8E6EB] font-medium mt-2 relative z-10 text-sm">
                Scan Student ID to book
              </p>
            </div>

            <CardContent className="px-8 py-8 space-y-6">
              <div className="p-6 rounded-[28px] bg-[#E8E6EB]/65 border-2 border-dashed border-[#E8E6EB] text-center flex flex-col items-center">
                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-4">
                  <ScanBarcode className="w-7 h-7 text-[#024059] animate-pulse" />                </div>
                <p className="text-[10px] text-[#024059]/65 font-bold uppercase mt-1">
                  Place ID in front of scanner
                </p>              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive" className="bg-[#E8E6EB]/60 border-0 text-[#024059] rounded-2xl p-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="font-bold text-xs">{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-[#024059]/65 uppercase tracking-[0.2em] ml-2">
                    Manual Entry
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g., 222-00000M"
                    value={studentNumber}
                    onChange={(e) => setStudentNumber(e.target.value.toUpperCase())}
                    onFocus={() => openKeyboardFor("studentNumber")}
                    disabled={loading}
                    className="text-center font-mono h-14 border-slate-100 focus-visible:ring-4 focus-visible:ring-[#E8E6EB] focus-visible:border-[#024059] rounded-[20px] text-lg bg-slate-50 font-bold"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full bg-[#024059] hover:bg-[#024059] text-white font-black h-14 text-base rounded-[20px] shadow-xl transition-all uppercase tracking-[0.1em]"
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <>
                      Continue <ArrowRight size={18} className="ml-2" />
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
                  <DialogHeader className="bg-[#024059] text-white p-6">
                    <DialogTitle className="text-2xl font-black uppercase tracking-tight">
                      Confirm Identity
                    </DialogTitle>
                    <p className="text-[11px] text-[#E8E6EB] font-bold uppercase tracking-wider mt-2">
                      Student ID is protected
                    </p>
                  </DialogHeader>

                  <div className="p-6 space-y-4">
                    <div className="rounded-2xl bg-[#E8E6EB]/60 border border-[#E8E6EB] p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Student ID
                      </p>
                      <p className="text-lg font-black text-[#024059]">
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
                      className="w-full rounded-xl h-12 bg-[#024059] hover:bg-[#024059] text-white text-[10px] font-black uppercase tracking-widest"
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
                    <DialogHeader className="bg-[#024059] p-8 text-white relative">
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
                              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-[#024059] font-black text-xl shadow-sm uppercase border border-[#E8E6EB]">
                                {f.name[0]}
                              </div>
                              <div>
                                <p className="font-black text-slate-800 text-lg leading-tight">{f.name}</p>
                                <p className="text-[10px] font-bold text-[#024059]/65 uppercase tracking-[0.2em] mt-1">
                                  {f.department?.name || "Faculty Member"}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 bg-[#E8E6EB]/60 text-[#024059] px-4 py-2 rounded-xl border border-[#E8E6EB] shadow-sm">
                              <div className="w-2 h-2 rounded-full bg-[#024059] animate-pulse" />
                              <span className="text-[10px] font-black uppercase tracking-wider">Active</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-16">
                          <Building2 className="w-16 h-16 text-slate-100 mx-auto mb-4" />
                          <p className="text-[#024059]/65 font-bold uppercase tracking-widest text-[10px]">
                            No active professors matching your search
                          </p>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl rounded-[40px] bg-white overflow-hidden">
            <CardContent className="p-8 h-full flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-black text-slate-800 uppercase text-xl flex items-center gap-3 tracking-tight">
                  <Monitor size={22} className="text-[#024059]" /> Live Monitor
                </h3>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#024059]/65 mb-1.5">
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
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#024059]/65 mb-1.5">
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

              <div className="grid grid-cols-3 gap-3 my-5">
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[9px] font-black uppercase text-[#024059]/65">In Session</p>
                  <p className="text-xl font-black text-[#024059]">{currentServing ? 1 : 0}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[9px] font-black uppercase text-[#024059]/65">Waiting</p>
                  <p className="text-xl font-black text-[#024059]">{waitingQueue.length}</p>
                </div>
                <div className="bg-[#024059] rounded-xl p-3 text-white">
                  <p className="text-[9px] font-black uppercase opacity-70">Total</p>
                  <p className="text-xl font-black">{liveQueue.length}</p>
                </div>
              </div>

              <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                {liveQueue.length > 0 ? (
                  liveQueue.map((ticket) => (
                    <div key={ticket.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <Badge
                          className={
                            ticket.status === "called"
                              ? "bg-[#E8E6EB]/60 text-[#024059]"
                              : "bg-[#E8E6EB]/60 text-[#024059]"
                          }
                        >
                          {ticket.status === "called" ? "IN SESSION" : "WAITING"}
                        </Badge>
                        <div className="flex items-center gap-1 text-[#024059]/65 text-xs font-bold">
                          <Clock size={12} />
                          {new Date(ticket.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>

                      <p className="text-2xl font-black text-slate-800">{ticket.student_display_name}</p>
                      <div className="p-3 rounded-xl bg-white border border-slate-100 flex items-center gap-3">
                        <UserCheck className="w-4 h-4 text-[#024059]" />
                        <div>
                          <p className="text-[10px] font-black text-[#024059]/65 uppercase">Professor</p>
                          <p className="text-xs font-bold text-slate-700">
                            {selectedFaculty?.name || "Not selected"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-full min-h-36 rounded-2xl border border-dashed border-slate-200 flex items-center justify-center text-center px-6">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#024059]/65">
                      No active queue for this professor.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl rounded-[40px] bg-white overflow-hidden">
            <CardContent className="p-8 h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-black text-slate-800 uppercase text-xl flex items-center gap-3 tracking-tight">
                  <Calendar size={22} className="text-[#024059]" /> Prof Schedules
                </h3>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 mb-4">
                <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mb-2">
                  Selected Professor
                </p>
                <p className="text-lg font-black text-slate-800">
                  {selectedFaculty?.name || "No professor selected"}
                </p>
                <p className="text-[10px] font-bold text-[#024059]/65 uppercase tracking-widest mt-1">
                  {selectedFaculty?.department?.name || "Department unavailable"}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 mb-4">
                <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mb-3">
                  Consultation Hours
                </p>
                <p className="text-sm font-black text-slate-700 whitespace-pre-line">
                  {selectedFaculty?.schedule || "No official hours posted yet."}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 mb-4">
                <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mb-3">
                  Meeting Preference
                </p>
                <div className="flex items-center gap-3">
                  {isOnline ? (
                    <Globe size={20} className="text-[#024059]" />
                  ) : (
                    <UserCheck size={20} className="text-[#024059]" />
                  )}
                  <span className="text-sm font-black text-slate-800 uppercase tracking-wider">
                    {meetingMethod.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-[9px] font-bold text-[#024059]/65 mt-3 uppercase tracking-widest">
                  {isOnline
                    ? "A Google Meet link will be shared by your professor."
                    : "Please proceed to the faculty office for consultation."}
                </p>
              </div>

              <div className="mt-auto pt-5 border-t border-slate-100">
                <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-widest mb-2">
                  Now Consulting 
                </p>
                <div className="flex items-center justify-between rounded-2xl bg-[#E8E6EB]/60 border border-[#E8E6EB] px-4 py-3">
                  <span className="text-lg font-black text-[#024059]">
                    {currentServing ? currentServing.student_display_name : "IDLE"}
                  </span>
                  {currentServing && (
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#024059]">
                      ~{getRemainingTime(currentServing.called_at || null)} mins left
                    </span>
                  )}
                </div>
              </div>
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

      <footer className="px-12 py-8 flex justify-between items-center bg-white border-t border-slate-50">
        <p className="text-[10px] font-black text-slate-200 uppercase tracking-[0.4em]">
          EARIST QUEUE SYSTEM (C) 2026
        </p>
        <button
          onClick={() => setLocation("/login")}
          className="text-[10px] font-black text-[#024059]/65 hover:text-[#024059] transition-colors uppercase tracking-[0.2em] border-b border-transparent hover:border-[#024059]"
        >
          Staff Login
        </button>
      </footer>
    </div>
  );
}
