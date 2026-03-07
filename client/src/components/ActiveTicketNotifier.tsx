import { useEffect, useRef, useState } from "react";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/lib/supabase";
import { ACTIVE_TICKETS_EVENTS, getActiveTicketIds, removeActiveTicketId } from "@/lib/activeTickets";

type QueueStatus = "waiting" | "called" | "completed" | "cancelled" | "rescheduled";

type QueueSnapshot = {
  status: QueueStatus;
  position: number | null;
};

const normalizeStatusLabel = (status: QueueStatus) => status.replace(/_/g, " ");

export default function ActiveTicketNotifier() {
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const channelsRef = useRef<Record<string, ReturnType<typeof supabase.channel>>>({});
  const previousSnapshotRef = useRef<Record<string, QueueSnapshot | null>>({});

  const shouldNotifyForTicket = (ticketId: string) => {
    if (typeof window === "undefined") return false;
    const path = window.location.pathname;
    return path !== `/status/${ticketId}`;
  };

  const sendNotification = (ticketId: string, title: string, message: string) => {
    if (!shouldNotifyForTicket(ticketId)) return;

    sonnerToast.success(message);

    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    new Notification(title, {
      body: message,
      tag: `ticket-${ticketId}`,
    });
  };

  const readQueueSnapshot = async (ticketId: string): Promise<QueueSnapshot | null> => {
    const { data: queueEntry, error: entryError } = await supabase
      .from("queue_entries")
      .select("id, faculty_id, status")
      .eq("id", ticketId)
      .maybeSingle();

    if (entryError || !queueEntry) return null;

    const terminalStatuses = ["completed", "cancelled", "rescheduled"];
    if (terminalStatuses.includes(queueEntry.status)) {
      return {
        status: queueEntry.status as QueueStatus,
        position: null,
      };
    }

    const { data: queueList, error: listError } = await supabase
      .from("queue_entries")
      .select("id")
      .eq("faculty_id", queueEntry.faculty_id)
      .in("status", ["waiting", "called"])
      .order("created_at", { ascending: true });

    if (listError || !queueList) {
      return {
        status: queueEntry.status as QueueStatus,
        position: null,
      };
    }

    const index = queueList.findIndex((entry) => entry.id === ticketId);

    return {
      status: queueEntry.status as QueueStatus,
      position: index >= 0 ? index : null,
    };
  };

  const refreshTicket = async (ticketId: string, notifyChanges: boolean) => {
    const latest = await readQueueSnapshot(ticketId);

    if (!latest) {
      removeActiveTicketId(ticketId);
      delete previousSnapshotRef.current[ticketId];
      return;
    }

    const previous = previousSnapshotRef.current[ticketId] || null;

    if (notifyChanges && previous) {
      if (previous.status !== latest.status) {
        if (latest.status === "called") {
          sendNotification(ticketId, "Your turn is ready", "You are now being called. Please proceed to your consultation.");
        } else if (["completed", "cancelled", "rescheduled"].includes(latest.status)) {
          sendNotification(
            ticketId,
            "Ticket updated",
            `Your booking is now marked as ${normalizeStatusLabel(latest.status)}.`
          );
        } else {
          sendNotification(ticketId, "Queue updated", `Your ticket is now ${normalizeStatusLabel(latest.status)}.`);
        }
      }

      if (
        latest.status === "waiting" &&
        previous.position !== null &&
        latest.position !== null &&
        latest.position < previous.position
      ) {
        sendNotification(ticketId, "Queue moved", `Good news, you moved to #${latest.position + 1} in line.`);
      }
    }

    previousSnapshotRef.current[ticketId] = latest;

    if (["completed", "cancelled", "rescheduled"].includes(latest.status)) {
      removeActiveTicketId(ticketId);
      delete previousSnapshotRef.current[ticketId];
    }
  };

  useEffect(() => {
    setTicketIds(getActiveTicketIds());

    const syncTickets = () => {
      setTicketIds(getActiveTicketIds());
    };

    window.addEventListener(ACTIVE_TICKETS_EVENTS.changed, syncTickets);
    window.addEventListener("storage", syncTickets);

    return () => {
      window.removeEventListener(ACTIVE_TICKETS_EVENTS.changed, syncTickets);
      window.removeEventListener("storage", syncTickets);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;

    Notification.requestPermission().catch(() => {
      // Permission can be denied; sonner toasts still work.
    });
  }, []);

  useEffect(() => {
    const activeIds = new Set(ticketIds);

    for (const [ticketId, channel] of Object.entries(channelsRef.current)) {
      if (activeIds.has(ticketId)) continue;
      supabase.removeChannel(channel);
      delete channelsRef.current[ticketId];
      delete previousSnapshotRef.current[ticketId];
    }

    ticketIds.forEach((ticketId) => {
      if (channelsRef.current[ticketId]) return;

      void refreshTicket(ticketId, false);

      const channel = supabase
        .channel(`active-ticket:${ticketId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "queue_entries", filter: `id=eq.${ticketId}` },
          () => {
            void refreshTicket(ticketId, true);
          }
        )
        .subscribe();

      channelsRef.current[ticketId] = channel;
    });

    return () => {
      // Cleanup runs on unmount only; active subscriptions persist through list updates.
    };
  }, [ticketIds]);

  useEffect(() => {
    return () => {
      Object.values(channelsRef.current).forEach((channel) => {
        supabase.removeChannel(channel);
      });
      channelsRef.current = {};
    };
  }, []);

  return null;
}
