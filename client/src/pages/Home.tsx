import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { 
  QrCode, LogOut, Monitor, Clock, ChevronDown, 
  Calendar, UserCheck, Search, Globe, ArrowRight 
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "react-hot-toast";

export default function Home() {
  const { isAuthenticated, signOut } = useAuth();
  const [, setLocation] = useLocation();

  const [faculties, setFaculties] = useState<any[]>([]);
  const [selectedMonitorProf, setSelectedMonitorProf] = useState<string | null>(null);
  const [liveQueue, setLiveQueue] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [statusInput, setStatusInput] = useState("");
  const [now, setNow] = useState(new Date());

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

  // Memoized function to fetch faculty list and preserve selection
  const loadFaculties = useCallback(async () => {
    const { data, error } = await supabase.from("faculty").select("*").order("name");
    if (error) {
      console.error("Failed to load faculties:", error);
      return;
    }

    const facultyList = data || [];
    setFaculties(facultyList);
    
    // Auto-select the first faculty if none is selected
    setSelectedMonitorProf((prev) => {
      if (prev && facultyList.some((f) => f.id === prev)) return prev;
      return facultyList.length > 0 ? facultyList[0].id : null;
    });
  }, []);

  // Initial load and ticking clock logic
  useEffect(() => {
    loadFaculties();
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [loadFaculties]);

  // Listen for real-time faculty changes (schedule, method, or status updates)
  useEffect(() => {
    const channel = supabase
      .channel("home-faculty-global-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "faculty" }, () => loadFaculties())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadFaculties]);

  // Sync Live Queue Monitor for the selected professor
  useEffect(() => {
    if (!selectedMonitorProf) return;
    
    const fetchQueue = async () => {
      const { data, error } = await supabase
        .from("queue_entries")
        .select("*")
        .eq("faculty_id", selectedMonitorProf)
        .in("status", ["waiting", "called"])
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Failed to load live queue:", error);
        setLiveQueue([]);
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
        const { data: identityRows, error: identityLookupError } = await supabase
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
        const { data: studentRows, error: studentLookupError } = await supabase
          .from("students")
          .select("*")
          .in("student_number", studentNumbers);

        if (studentLookupError) {
          console.error("Failed to resolve student names:", studentLookupError);
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
    };

    fetchQueue();

    const channel = supabase.channel(`monitor:${selectedMonitorProf}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'queue_entries',
        filter: `faculty_id=eq.${selectedMonitorProf}`
      }, () => fetchQueue())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedMonitorProf]);

  const selectedFaculty = faculties.find(f => f.id === selectedMonitorProf);
  const currentServing = liveQueue.find(q => q.status === 'called');
  const upNextQueue = liveQueue.filter(q => q.status === 'waiting');
  
  const meetingMethod = selectedFaculty?.consultation_method || "face_to_face";
  const isOnline = meetingMethod === "online";

  // Calculate estimated remaining time based on a 15-minute standard session
  const getRemainingTime = (calledAt: string | null) => {
    if (!calledAt) return 15;
    const start = new Date(calledAt).getTime();
    const end = start + (15 * 60 * 1000); 
    return Math.max(0, Math.floor((end - now.getTime()) / 60000));
  };

  const handleQuickSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusInput.trim()) return;
    
    const toastId = toast.loading("Checking ticket status...");
    const { data, error } = await supabase.from("queue_entries")
      .select("id")
      .or(`id.eq.${statusInput},student_number.eq.${statusInput.toUpperCase()}`)
      .in("status", ["waiting", "called"])
      .maybeSingle();
    
    if (data) {
      toast.success("Ticket found!", { id: toastId });
      setLocation(`/status/${data.id}`);
    } else {
      toast.error("No active session found for this ID.", { id: toastId });
    }
  };

  const minutesLeft = getRemainingTime(currentServing?.called_at || null);

  return (
    <div className="min-h-screen bg-[#FFFCEF] font-sans flex flex-col">
      <nav className="bg-white border-b border-[#659BB9] px-8 py-4 sticky top-0 z-30 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#659BB9] rounded-xl flex items-center justify-center shadow-md text-white font-black text-xs">EQ</div>
          <h1 className="text-xl font-black text-[#659BB9] uppercase tracking-tight">EARIST Kiosk</h1>
        </div>
        {isAuthenticated && (
          <Button variant="ghost" onClick={() => signOut()} className="text-[#659BB9]/60 hover:text-[#659BB9] uppercase text-[10px] font-black tracking-widest">
            <LogOut size={16} className="mr-2" /> Sign Out
          </Button>
        )}
      </nav>

      <main className="max-w-7xl mx-auto w-full px-8 py-12 flex flex-col lg:flex-row gap-10">
        
        {/* LEFT COLUMN: REGISTRATION */}
        <div className="lg:w-1/3">
          <Card className="border-0 shadow-2xl rounded-[48px] overflow-hidden bg-white sticky top-24">
            <div className="bg-[#659BB9] p-10 text-center text-white">
              <h2 className="text-3xl font-black uppercase leading-none tracking-tighter">Get Started</h2>
              <p className="text-[#FFFCEF] mt-3 text-sm font-medium">Scan Student ID to book</p>
            </div>
            <CardContent className="p-10 text-center">
              <div className="mb-10 p-8 rounded-[32px] bg-[#659BB9]/30 border-2 border-dashed border-[#659BB9] flex flex-col items-center">
                 <QrCode className="w-16 h-16 text-[#659BB9] mb-4" />
                 <h3 className="font-black text-[#659BB9] uppercase tracking-[0.2em] text-[10px]">Scanner Active</h3>
              </div>
              <Button onClick={() => setLocation("/kiosk")} className="w-full bg-[#659BB9] hover:bg-[#659BB9] h-20 rounded-[32px] font-black uppercase text-white shadow-xl shadow-[#659BB9]/20 text-lg transition-transform active:scale-95">
                Start Booking
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: DUAL BUBBLE MONITOR */}
        <div className="lg:w-2/3 grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* BUBBLE 1: LIVE MONITOR */}
          <Card className="border-0 shadow-xl rounded-[48px] bg-white overflow-hidden border-t-8 border-[#659BB9] flex flex-col">
            <CardContent className="p-10 flex-1 flex flex-col">
              <div className="flex justify-between items-center mb-8">
                <h3 className="font-black text-[#659BB9] uppercase text-xl flex items-center gap-3 tracking-tighter">
                  <Monitor size={24} className="text-[#659BB9]"/> Live Monitor
                </h3>
                
                {/* Professor Dropdown Selection */}
                <div className="relative">
                  <button 
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)} 
                    className="bg-slate-50 border border-slate-100 px-4 py-2.5 rounded-2xl flex items-center gap-2 text-[10px] font-black text-[#659BB9]/75 uppercase transition-all hover:border-[#659BB9]"
                  >
                    Prof. {selectedFaculty?.name || "Loading..."} <ChevronDown size={14}/>
                  </button>
                  {isDropdownOpen && (
                    <div className="absolute top-full right-0 mt-2 w-64 bg-white shadow-2xl rounded-3xl overflow-hidden z-50 border border-slate-50 animate-in fade-in slide-in-from-top-2">
                      {faculties.map(f => (
                        <button 
                          key={f.id} 
                          onClick={() => { setSelectedMonitorProf(f.id); setIsDropdownOpen(false); }} 
                          className="w-full text-left px-5 py-4 hover:bg-[#659BB9]/30 text-xs font-black text-[#659BB9]/85 border-b border-slate-50 last:border-0 uppercase transition-colors"
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 rounded-[40px] p-8 text-center border border-slate-100 mb-8 shadow-inner">
                <Badge className="bg-[#659BB9]/30 text-[#659BB9] border-0 text-[10px] font-black mb-3 uppercase tracking-widest px-4 py-1.5 rounded-full">
                   Now Consulting
                </Badge>
                <h4 className="text-6xl font-black text-[#659BB9] tracking-tighter uppercase leading-none">
                  {currentServing ? currentServing.student_display_name : "IDLE"}
                </h4>
                {currentServing && (
                  <p className="text-[10px] font-black text-[#659BB9] mt-6 uppercase tracking-widest flex items-center justify-center gap-2">
                    <Clock size={12} /> ~{minutesLeft} mins remaining
                  </p>
                )}
              </div>

              <div className="space-y-3 mb-10 flex-grow">
                <p className="text-[10px] font-black text-[#659BB9]/60 uppercase tracking-widest pl-2 mb-2">Upcoming Tickets:</p>
                {upNextQueue.length > 0 ? upNextQueue.slice(0, 3).map((s, idx) => (
                  <div key={s.id} className="bg-white p-5 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm hover:border-[#659BB9] transition-colors">
                    <span className="text-sm font-black text-[#659BB9]/85 tracking-tight">{s.student_display_name}</span>
                    <Badge className="bg-[#659BB9]/30 text-[#659BB9] border-0 text-[9px] font-black px-3 py-1 uppercase tracking-tighter">
                      +{ (idx + 1) * 15 }m wait
                    </Badge>
                  </div>
                )) : (
                  <div className="py-6 text-center opacity-30 text-[10px] font-black uppercase tracking-widest">
                    No waiting students
                  </div>
                )}
              </div>

              {/* Status Quick Search */}
              <form onSubmit={handleQuickSearch} className="pt-6 border-t border-slate-100 mt-auto flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#659BB9]/60" size={16} />
                  <input 
                    type="text" 
                    placeholder="Enter Ticket ID to check status..." 
                    className="w-full bg-slate-50 border-transparent focus:ring-2 focus:ring-[#659BB9] focus:bg-white rounded-[20px] py-4 pl-12 text-[10px] font-black uppercase tracking-widest transition-all" 
                    value={statusInput} 
                    onChange={(e) => setStatusInput(e.target.value)} 
                  />
                </div>
                <button type="submit" className="bg-[#659BB9] text-white p-4 rounded-[20px] shadow-lg transition-all hover:bg-[#659BB9] active:scale-95 flex items-center justify-center">
                  <ArrowRight size={18} />
                </button>
              </form>
            </CardContent>
          </Card>

          {/* BUBBLE 2: PROFESSOR SCHEDULE & METHOD */}
          <Card className="border-0 shadow-xl rounded-[48px] bg-white overflow-hidden flex flex-col">
            <CardContent className="p-10 flex-1 flex flex-col">
              <div className="flex items-center gap-5 mb-10">
                <div className="w-16 h-16 bg-[#659BB9]/30 rounded-[28px] flex items-center justify-center text-[#659BB9] shadow-inner">
                  <Calendar size={32} />
                </div>
                <div>
                  <h3 className="font-black text-[#659BB9] uppercase text-2xl leading-none tracking-tighter">Schedule</h3>
                  <p className="text-[10px] font-black text-[#659BB9]/60 uppercase tracking-widest mt-1">Available Hours</p>
                </div>
              </div>

              <div className="space-y-6 flex-1">
                <div className="p-8 bg-slate-50 rounded-[40px] border border-slate-100 transition-all hover:bg-white hover:shadow-md">
                  <p className="text-[10px] font-black text-[#659BB9]/60 uppercase tracking-widest mb-4">Consultation Windows</p>
                  <p className="text-sm font-black text-[#659BB9]/85 leading-relaxed uppercase whitespace-pre-line">
                    {selectedFaculty?.schedule || "No official hours posted yet."}
                  </p>
                </div>
                
                <div className="p-8 bg-slate-50 rounded-[40px] border border-slate-100 flex flex-col items-center text-center transition-all hover:bg-white hover:shadow-md">
                  <p className="text-[10px] font-black text-[#659BB9]/60 uppercase tracking-widest mb-4">Meeting Preference</p>
                  <div className="flex items-center gap-3 bg-white px-8 py-4 rounded-[24px] shadow-sm border border-[#659BB9]">
                    {isOnline ? <Globe size={24} className="text-[#659BB9]" /> : <UserCheck size={24} className="text-[#659BB9]" />}
                    <span className="text-sm font-black text-[#659BB9] uppercase tracking-widest">
                       {meetingMethod.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-[9px] font-bold text-[#659BB9]/60 mt-4 uppercase tracking-widest">
                    {isOnline ? "A Google Meet link will be provided." : "Please proceed to the faculty office."}
                  </p>
                </div>
              </div>

              <button 
                onClick={() => setLocation("/login")} 
                className="mt-12 text-[10px] font-black text-[#659BB9]/60 hover:text-[#659BB9] uppercase tracking-[0.4em] text-center w-full transition-colors border-t border-slate-50 pt-8"
              >
                Faculty & Admin Portal
              </button>
            </CardContent>
          </Card>

        </div>
      </main>

      <footer className="mt-auto px-12 py-10 bg-white border-t border-slate-50 text-center">
        <p className="text-[10px] font-black text-[#659BB9]/55 uppercase tracking-[0.6em] leading-none">
          EARIST QUEUE MANAGEMENT SYSTEM © 2026
        </p>
      </footer>
    </div>
  );
}
