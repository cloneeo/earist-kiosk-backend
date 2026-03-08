import React, { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, Download, 
  ArrowRight, QrCode, Loader2, AlertCircle 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addActiveTicketId } from "@/lib/activeTickets";
import { toast as sonnerToast } from "sonner";
import { buildApiUrl } from "@/lib/apiBase";
import {
  clearPendingBookingEmail,
  enqueuePendingBookingEmail,
  hasBookingEmailBeenSent,
  markBookingEmailSent,
} from "@/lib/pendingBookingEmails";

const getMeetingLinkFromSchedule = (scheduleRaw: unknown): string => {
  const sanitizeMeetLink = (value: unknown): string => {
    const link = String(value || "").trim();
    if (!/^https:\/\/meet\.google\.com\//i.test(link)) return "";
    if (/^https:\/\/meet\.google\.com\/new(?:[/?#]|$)/i.test(link)) return "";
    return link;
  };

  if (!scheduleRaw) return "";

  if (typeof scheduleRaw === "object") {
    const meetingLink = (scheduleRaw as { meetingLink?: unknown }).meetingLink;
    return sanitizeMeetLink(meetingLink);
  }

  const raw = String(scheduleRaw).trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { meetingLink?: unknown };
    return sanitizeMeetLink(parsed.meetingLink);
  } catch {
    return "";
  }
};

export default function QueueConfirmation() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const queueId = params.get("queueId") || "";
  const studentName = params.get("name") || "";
  const studentEmail = params.get("email") || "";
  const bookingEmailUrl = buildApiUrl("/api/booking/email");
  
  const [queueData, setQueueData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const emailDispatchRef = useRef(false);

  const maskStudentNumber = (studentId: string) => {
    const normalized = studentId.trim().toUpperCase();
    if (!normalized) return "";
    const parts = normalized.split("-");
    if (parts.length === 2) {
      const suffix = parts[1].slice(-1);
      return `${parts[0]}-*****${suffix}`;
    }
    return `${normalized.slice(0, 3)}*****${normalized.slice(-1)}`;
  };

  useEffect(() => {
    const fetchQueueDetails = async () => {
      try {
        if (!queueId) throw new Error("Queue ID not provided");
        addActiveTicketId(queueId);
        
        const { data, error: fetchErr } = await supabase
          .from("queue_entries")
          .select(`
            *,
            faculty:faculty(name,schedule)
          `)
          .eq("id", queueId)
          .single();

        if (fetchErr) throw fetchErr;
        setQueueData(data);
        
        // Log to history
        await supabase.from("queue_history").insert({
          queue_entry_id: queueId,
          action: "booked",
          notes: `Student ${data.student_number} booked for ${data.consultation_type}`,
        });

      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load booking details");
      } finally {
        setLoading(false);
      }
    };
    fetchQueueDetails();
  }, [queueId]);

  useEffect(() => {
    if (!queueId || loading || error || !queueData) return;
    if (emailDispatchRef.current) return;
    if (hasBookingEmailBeenSent(queueId)) return;

    emailDispatchRef.current = true;

    const queueMeetLink = getMeetingLinkFromSchedule((queueData as any)?.faculty?.schedule);
    enqueuePendingBookingEmail(queueId, studentEmail, queueMeetLink || undefined);

    const sendOne = async (targetQueueId: string, targetEmail: string, targetMeetLink?: string) => {
      const payloadBody = JSON.stringify({
        queueId: targetQueueId,
        studentEmail: targetEmail,
        meetLink: targetMeetLink || undefined,
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(bookingEmailUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            keepalive: true,
            body: payloadBody,
          });

          const raw = await response.text().catch(() => "");
          let payload = {} as {
            ok?: boolean;
            message?: string;
            deduped?: boolean;
          };

          if (raw) {
            try {
              payload = JSON.parse(raw) as typeof payload;
            } catch {
              payload = { message: raw };
            }
          }

          if (response.ok && (payload.ok || payload.deduped)) {
            clearPendingBookingEmail(targetQueueId);
          }

          return { response, payload };
        } catch {
          if (attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            continue;
          }

          if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
            try {
              const beaconPayload = new Blob([payloadBody], { type: "application/json" });
              navigator.sendBeacon(bookingEmailUrl, beaconPayload);
            } catch {
              // Ignore beacon fallback errors.
            }
          }
        }
      }

      return null;
    };

    const attemptDispatch = async () => {
      const result = await sendOne(queueId, studentEmail, queueMeetLink || undefined);
      if (!result) {
        sonnerToast("Booking email queued. Please check inbox in a moment.", { icon: "ℹ" });
        return;
      }

      const { response, payload } = result;

      if (!response.ok) {
        if (response.status === 404) {
          sonnerToast.error("Booking email API not found on backend. Check deploy route and VITE_API_BASE_URL.");
          return;
        }
        sonnerToast.error(payload.message || `Booking email API failed (${response.status}).`);
        return;
      }

      if (payload.ok && !payload.deduped) {
        markBookingEmailSent(queueId);
        sonnerToast.success("Booking email sent.");
        return;
      }

      if (payload.deduped) {
        markBookingEmailSent(queueId);
        return;
      }

      if (!payload.ok) {
        sonnerToast.error(payload.message || "Booking email was not sent.");
      }
    };

    void attemptDispatch();
  }, [queueId, queueData, loading, error, studentEmail, bookingEmailUrl]);

  const shareUrl = `${window.location.origin}/status/${queueId}`;

  const handleDownloadQR = () => {
    const svg = document.getElementById("qr-code-svg");
    if (svg) {
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);
        const pngFile = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.download = `earist-ticket-${queueData?.student_number}.png`;
        downloadLink.href = pngFile;
        downloadLink.click();
      };
      img.src = "data:image/svg+xml;base64," + btoa(svgData);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f3f1f6]">
      <Loader2 className="w-12 h-12 animate-spin text-[#c62828] mb-4" />
      <p className="font-black text-[#c62828] uppercase tracking-[0.3em] text-xs">Generating Ticket...</p>
    </div>
  );

  if (error || !queueData) return (
    <div className="min-h-screen bg-[#f3f1f6] flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <Alert variant="destructive" className="bg-[#f3f1f6]/60 border-0 text-[#c62828] rounded-[32px] p-8 shadow-sm">
          <AlertCircle className="h-8 w-8 mb-4" />
          <AlertDescription className="font-bold text-lg leading-tight">{error || "Booking not found"}</AlertDescription>
        </Alert>
        <Button onClick={() => setLocation("/kiosk")} className="mt-6 w-full h-16 bg-[#c62828] hover:bg-[#c62828] rounded-2xl text-lg font-black uppercase tracking-widest">
          Return to Kiosk
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f3f1f6] flex flex-col font-sans items-center justify-center p-6">
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-md w-full"
      >
        <Card className="border-0 shadow-[0_40px_80px_rgba(0,0,0,0.1)] rounded-[56px] bg-white overflow-hidden text-center relative">
          {/* Header Section */}
          <div className="bg-[#c62828] pt-14 pb-10 px-10 text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-bl-full -mr-10 -mt-10"></div>
            <CheckCircle2 className="w-16 h-16 text-white mx-auto mb-4 relative z-10" />
            <CardTitle className="text-4xl font-black text-white relative z-10 tracking-tighter uppercase">Confirmed!</CardTitle>
            <CardDescription className="text-[#f3f1f6] font-bold mt-2 relative z-10 text-xs uppercase tracking-widest opacity-80">
              Your booking is now in queue
            </CardDescription>
          </div>

          <CardContent className="px-10 py-12">
            {/* QR Code Section */}
            <div className="flex flex-col items-center mb-10">
              <div className="bg-white p-6 rounded-[40px] border-2 border-dashed border-[#f3f1f6] shadow-inner relative group transition-all hover:border-[#f3f1f6]">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-4 py-0.5 rounded-full text-[10px] font-black text-[#c62828] uppercase tracking-[0.2em] border border-[#f3f1f6] flex items-center gap-2">
                  <QrCode className="w-3 h-3" /> E-Ticket
                </div>
                <QRCodeSVG 
                  id="qr-code-svg"
                  value={shareUrl} 
                  size={180} 
                  level="H"
                  includeMargin={false}
                />
              </div>
              <p className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-[0.2em] mt-6">
                Scan to track on your phone
              </p>
            </div>

            {/* TICKET DETAILS */}
            <div className="bg-slate-50 rounded-[32px] p-8 mb-10 space-y-5 border border-slate-100/50">
              <div className="flex justify-between items-center border-b border-slate-200/50 pb-4">
                <span className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest text-left">Student Name</span>
                <span className="text-sm font-black text-slate-800">{studentName || "Verified Student"}</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-200/50 pb-4">
                <span className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest text-left">Student ID</span>
                <span className="text-sm font-black text-slate-800">{maskStudentNumber(queueData?.student_number || "")}</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-200/50 pb-4">
                <span className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest text-left">Professor</span>
                <span className="text-sm font-black text-slate-800">{queueData?.faculty?.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest text-left">Method</span>
                <Badge variant="outline" className="bg-[#f3f1f6]/60 text-[#c62828] border-[#f3f1f6] font-black px-4 py-1.5 rounded-xl text-[10px] uppercase">
                  {queueData?.consultation_type?.replace('_', ' ')}
                </Badge>
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div className="space-y-4">
              <Button 
                onClick={() => setLocation(`/status/${queueId}`)}
                className="w-full bg-[#c62828] hover:bg-[#c62828] text-white font-black h-16 rounded-2xl shadow-xl shadow-[#c62828]/10 flex items-center justify-center gap-3 uppercase tracking-widest text-sm transition-all active:scale-95"
              >
                Track Live Status <ArrowRight size={20} />
              </Button>

              <div className="grid grid-cols-2 gap-4">
                <Button 
                  variant="outline" 
                  className="h-14 border-slate-100 text-slate-500 rounded-2xl font-black uppercase text-[10px] tracking-widest flex gap-2 hover:bg-slate-50 hover:text-[#c62828] transition-all"
                  onClick={handleDownloadQR}
                >
                  <Download size={16} /> Save Ticket
                </Button>
                <Button
                  variant="outline"
                  className="h-14 border-slate-100 text-slate-500 rounded-2xl font-black uppercase text-[10px] tracking-widest flex gap-2 hover:bg-slate-50"
                  onClick={() => setLocation("/kiosk")}
                >
                  Return to Kiosk
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="mt-10 text-center text-[10px] font-black text-[#c62828]/55 uppercase tracking-[0.4em]">
          EARIST QUEUE SYSTEM © 2026
        </p>
      </motion.div>
    </div>
  );
}

