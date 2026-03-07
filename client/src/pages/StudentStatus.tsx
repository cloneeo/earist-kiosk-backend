import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  Clock, Users, Loader2, RefreshCw, ChevronLeft, 
  Bell, Monitor, UserCheck, Share2, MapPin, QrCode, 
  AlertCircle, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import { toast } from "react-hot-toast";
import type { Database } from "@/lib/supabase";
import { addActiveTicketId, removeActiveTicketId } from "@/lib/activeTickets";

type QueueEntry = Database["public"]["Tables"]["queue_entries"]["Row"];
type Faculty = Database["public"]["Tables"]["faculty"]["Row"];

export default function StudentStatus() {
  const [, setLocation] = useLocation();
  const pathname = window.location.pathname;
  const queueId = pathname.split("/").pop() || "";

  const [queueEntry, setQueueEntry] = useState<QueueEntry | null>(null);
  const [faculty, setFaculty] = useState<Faculty | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [meetLink, setMeetLink] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const lastStatusRef = useRef<QueueEntry["status"] | null>(null);
  const lastQueuePositionRef = useRef<number | null>(null);
  const didInitRealtimeRef = useRef(false);

  const shareUrl = window.location.href;

  const notifyStudent = (title: string, message: string) => {
    toast.success(message);

    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    new Notification(title, {
      body: message,
      tag: `queue-status-${queueId}`,
    });
  };

  const loadQueueData = async () => {
    try {
      if (!queueId) throw new Error("Invalid Ticket ID provided.");

      // 1. Fetch the specific ticket
      const { data: queue, error: queueErr } = await supabase
        .from("queue_entries")
        .select("*")
        .eq("id", queueId)
        .maybeSingle();

      if (queueErr) throw queueErr;
      if (!queue) throw new Error("Ticket not found or has expired.");
      
      setQueueEntry(queue);

      // 2. Fetch Assigned Faculty
      const { data: fac } = await supabase
        .from("faculty")
        .select("*")
        .eq("id", queue.faculty_id)
        .single();
      setFaculty(fac);

      // 3. Calculate Position in Line
      const { data: queueList } = await supabase
        .from("queue_entries")
        .select("id")
        .eq("faculty_id", queue.faculty_id)
        .in("status", ["waiting", "called"])
        .order("created_at", { ascending: true });

      const position = queueList?.findIndex((q) => q.id === queueId) ?? -1;
      setQueuePosition(position >= 0 ? position : null);

      const { data: meetHistory } = await supabase
        .from("queue_history")
        .select("notes")
        .eq("queue_entry_id", queueId)
        .eq("action", "google_meet_link_shared")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setMeetLink(String(meetHistory?.notes || "").trim());

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;

    Notification.requestPermission().catch(() => {
      // Ignore permission prompt errors; toasts still provide realtime feedback.
    });
  }, []);

  useEffect(() => {
    addActiveTicketId(queueId);

    loadQueueData();
    const subscription = supabase
      .channel(`queue:${queueId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, () => loadQueueData())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_history", filter: `queue_entry_id=eq.${queueId}` }, () => loadQueueData())
      .subscribe();

    const ticker = setInterval(() => setNow(new Date()), 1000);

    return () => {
      subscription.unsubscribe();
      clearInterval(ticker);
    };
  }, [queueId]);

  useEffect(() => {
    if (!queueEntry) return;

    if (!didInitRealtimeRef.current) {
      lastStatusRef.current = queueEntry.status;
      lastQueuePositionRef.current = queuePosition;
      didInitRealtimeRef.current = true;
      return;
    }

    if (lastStatusRef.current !== queueEntry.status) {
      if (queueEntry.status === "called") {
        notifyStudent("Your turn is ready", "You are now being called. Please proceed to your consultation.");
      } else if (queueEntry.status === "completed") {
        notifyStudent("Consultation completed", "Your consultation has been marked as completed.");
      } else if (queueEntry.status === "waiting") {
        notifyStudent("Queue updated", "Your ticket is currently waiting in queue.");
      }
    }

    if (
      queueEntry.status === "waiting" &&
      lastQueuePositionRef.current !== null &&
      queuePosition !== null &&
      queuePosition < lastQueuePositionRef.current
    ) {
      notifyStudent("Queue moved", `Good news, you moved to #${queuePosition + 1} in line.`);
    }

    lastStatusRef.current = queueEntry.status;
    lastQueuePositionRef.current = queuePosition;

    if (queueEntry.status === "completed" || queueEntry.status === "cancelled" || queueEntry.status === "rescheduled") {
      removeActiveTicketId(queueId);
    }
  }, [queueEntry, queuePosition]);

  const getRemainingTime = () => {
    if (!queueEntry?.called_at) return 15;
    const start = new Date(queueEntry.called_at).getTime();
    const end = start + (15 * 60 * 1000); 
    return Math.max(0, Math.floor((end - now.getTime()) / 60000));
  };

  const handleShare = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success("Link copied to clipboard!");
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#E8E6EB]">
      <Loader2 className="w-12 h-12 animate-spin text-[#024059] mb-4" />
      <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-[0.3em]">Syncing Live Status...</p>
    </div>
  );

  if (error || !queueEntry || !faculty) {
    return (
      <div className="min-h-screen bg-[#E8E6EB] p-8 flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 bg-[#E8E6EB]/60 text-[#024059] rounded-[28px] flex items-center justify-center mb-6">
           <AlertCircle size={40} />
        </div>
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter mb-2">Ticket Not Found</h2>
        <p className="text-[#024059]/65 font-medium max-w-xs mb-8">This session may have ended or the Ticket ID entered is incorrect.</p>
        <Button onClick={() => setLocation("/kiosk")} className="bg-[#024059] hover:bg-[#024059] text-white rounded-2xl h-16 px-10 font-black uppercase tracking-widest shadow-xl shadow-[#024059]/20 active:scale-95 transition-all">
          Back to Kiosk
        </Button>
      </div>
    );
  }

  const isCalled = queueEntry.status === "called";
  const minutesLeft = getRemainingTime();
  const totalWait = isCalled ? minutesLeft : (minutesLeft + ((queuePosition || 0) * 15));

  return (
    <div className="min-h-screen bg-[#E8E6EB] flex flex-col font-sans">
      <header className="px-8 py-6 flex items-center justify-between bg-white border-b border-[#E8E6EB] shadow-sm sticky top-0 z-30">
        <button onClick={() => setLocation("/kiosk")} className="text-[#024059]/65 hover:text-[#024059] transition-colors flex items-center gap-2 font-black text-[10px] uppercase tracking-widest">
          <ChevronLeft className="w-5 h-5" /> Kiosk
        </button>
        <div className="text-center">
          <h1 className="text-[10px] font-black text-[#024059]/65 uppercase tracking-[0.2em]">TICKET: {queueId.slice(0, 8).toUpperCase()}</h1>
        </div>
        <button onClick={loadQueueData} className="text-[#024059]/65 hover:text-[#024059] active:rotate-180 transition-transform duration-500">
          <RefreshCw className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 p-8 flex flex-col items-center max-w-2xl mx-auto w-full">
        
        {/* STATUS INDICATOR */}
        <div className="text-center mb-10">
           <motion.div 
            initial={{ scale: 0.8, opacity: 0 }} 
            animate={{ scale: 1, opacity: 1 }}
            className={`inline-flex items-center justify-center w-20 h-20 rounded-[32px] mb-6 shadow-lg ${isCalled ? 'bg-[#024059] text-white' : 'bg-[#E8E6EB]/60 text-[#024059]'}`}
           >
             {isCalled ? <UserCheck className="w-10 h-10 animate-bounce" /> : <Clock className="w-10 h-10" />}
           </motion.div>
           <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter leading-none">
             {isCalled ? "You are Next!" : "In the Queue"}
           </h2>
           <p className="text-[10px] font-black text-[#024059]/65 uppercase tracking-[0.2em] mt-3">Active Session for Student {queueEntry.student_number}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-8">
          {/* POSITION CARD */}
          <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="relative">
            <div className={`absolute -top-4 left-6 right-6 h-12 rounded-t-[32px] z-0 shadow-inner ${isCalled ? 'bg-[#024059]' : 'bg-[#E8E6EB]/70'}`} />
            <Card className="relative z-10 border-0 shadow-[0_20px_40px_rgba(0,0,0,0.04)] rounded-[40px] overflow-hidden bg-white text-center p-10">
              <p className="text-[10px] font-black text-[#024059]/55 uppercase tracking-[0.3em] mb-2">Queue Position</p>
              <h3 className={`text-7xl font-black tracking-tighter ${isCalled ? 'text-[#024059]' : 'text-slate-800'}`}>
                {isCalled ? "NOW" : `#${(queuePosition || 0) + 1}`}
              </h3>
              <div className="mt-6 pt-6 border-t border-slate-50 flex items-center justify-center gap-2 text-slate-500 font-black text-[10px] uppercase tracking-widest">
                <Clock className="w-4 h-4 text-[#024059]" /> Est. {totalWait} mins
              </div>
            </Card>
          </motion.div>

          {/* DETAILS CARD */}
          <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
            <Card className="border-0 shadow-[0_20px_40px_rgba(0,0,0,0.04)] rounded-[40px] bg-white p-10 h-full flex flex-col justify-between">
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-[#024059] shadow-inner"><Users className="w-6 h-6" /></div>
                  <div>
                    <p className="text-[10px] font-black text-[#024059]/55 uppercase tracking-widest">Professor</p>
                    <p className="text-lg font-black text-slate-800 leading-tight">{faculty.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-[#024059] shadow-inner"><MapPin className="w-6 h-6" /></div>
                  <div>
                    <p className="text-[10px] font-black text-[#024059]/55 uppercase tracking-widest">Mode</p>
                    <p className="text-lg font-black text-slate-800 uppercase tracking-tighter">{queueEntry.consultation_type?.replace('_', ' ')}</p>
                  </div>
                </div>
                {queueEntry.consultation_type === "google_meet" && meetLink && (
                  <a
                    href={meetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-[#E8E6EB] bg-[#E8E6EB]/60 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#024059] hover:bg-[#E8E6EB]/70"
                  >
                    Join Google Meet <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <button onClick={handleShare} className="w-full mt-8 py-4 bg-slate-50 hover:bg-[#E8E6EB]/60 hover:text-[#024059] text-[#024059]/65 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 border border-slate-100 transition-all">
                <Share2 className="w-3 h-3" /> Share Live Status
              </button>
            </Card>
          </motion.div>
        </div>

        {/* MOBILE SCAN SECTION */}
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="w-full">
          <Card className="border-0 shadow-[0_30px_60px_rgba(0,0,0,0.06)] rounded-[48px] bg-white p-12 text-center flex flex-col items-center gap-8 border-t-8 border-[#024059]">
            <div className="p-6 bg-white rounded-[40px] shadow-inner border-2 border-dashed border-[#E8E6EB] group hover:border-[#024059] transition-colors">
               <QRCodeSVG value={shareUrl} size={180} />
            </div>
            <div>
              <h3 className="font-black text-slate-900 uppercase tracking-tight text-xl">Take it with you</h3>
              <p className="text-xs text-[#024059]/65 font-bold uppercase mt-2 tracking-widest">Scan to track from your mobile device.</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-black text-[#024059] uppercase tracking-[0.2em]">
              <div className="h-2 w-2 rounded-full bg-[#E8E6EB]/600 animate-pulse" /> Live Updates Active
            </div>
          </Card>
        </motion.div>

        <footer className="mt-16 text-center pb-12">
          <p className="text-[10px] font-black text-slate-200 uppercase tracking-[0.4em]">
            EARIST QUEUE SYSTEM © 2026
          </p>
        </footer>
      </main>
    </div>
  );
}