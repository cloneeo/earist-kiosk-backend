import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { CheckCircle2, QrCode, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function ConfirmationPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const queueId = new URLSearchParams(search).get("queueId");
  
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState<any>(null);

  useEffect(() => {
    const fetchTicket = async () => {
      if (!queueId) return;
      
      // Fetch queue details and join with faculty name
      const { data, error } = await supabase
        .from("queue_entries")
        .select(`
          *,
          faculty:faculty_id (name)
        `)
        .eq("id", queueId)
        .single();

      if (!error) setEntry(data);
      setLoading(false);
    };
    fetchTicket();
  }, [queueId]);

  if (loading) return <div className="min-h-screen flex items-center justify-center p-4"><Loader2 className="animate-spin" /></div>;
  if (!entry) return <div className="text-center p-6 sm:p-10">Ticket not found.</div>;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row border border-slate-200 animate-in fade-in zoom-in duration-300">
        
        {/* Left Panel: Confirmation Status */}
        <div className="flex-1 p-6 sm:p-12 flex flex-col items-center justify-center text-center space-y-6 bg-white">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Your ticket is ready!</h2>
            <p className="text-slate-500 text-sm leading-relaxed px-4">
              We've sent your entry to the faculty monitor. Please wait for your number to be called.
            </p>
          </div>
          <div className="pt-6 space-y-3 w-full max-w-xs">
            <Button 
              onClick={() => setLocation("/")}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-12 font-bold"
            >
              Got It
            </Button>
            <Button 
              variant="ghost" 
              className="w-full text-[#024059]/65 text-xs"
              onClick={() => setLocation("/kiosk")}
            >
              Submit another ticket
            </Button>
          </div>
        </div>

        {/* Right Panel: Ticket Details (Split Sidebar Style) */}
        <div className="w-full md:w-[320px] bg-slate-50 p-6 sm:p-8 border-t md:border-t-0 md:border-l border-slate-100 flex flex-col">
          <h3 className="text-slate-900 font-bold mb-8 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#024059]" /> Ticket Summary
          </h3>
          
          <div className="space-y-6 flex-1">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider font-bold text-[#024059]/65">Professor</p>
              <p className="text-sm font-semibold text-slate-700 break-words">{entry.faculty?.name || "Professor"}</p>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider font-bold text-[#024059]/65">Student ID</p>
              <p className="text-sm font-semibold text-slate-700 font-mono tracking-tighter break-all">{entry.student_number}</p>
            </div>

            <div className="pt-6 border-t border-slate-200 space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#024059]/65">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span className="font-bold text-slate-600 uppercase tracking-tighter">{entry.consultation_type.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#024059]/65">Time Logged</span>
                <span className="font-bold text-slate-600">
                  {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>

          {/* Position & QR Section */}
          <div className="mt-8 pt-6 border-t border-slate-200 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500 font-medium">Status</span>
              <span className="text-xl font-black text-emerald-600">ACTIVE</span>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-slate-200 flex items-center justify-center shadow-sm">
               <QrCode className="w-24 h-24 text-slate-800" />
            </div>
            <p className="text-[9px] text-center text-[#024059]/65 font-bold uppercase tracking-[0.2em]">
              Scan at Kiosk Monitor
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}