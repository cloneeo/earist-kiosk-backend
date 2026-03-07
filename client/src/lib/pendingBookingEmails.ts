type PendingBookingEmail = {
  queueId: string;
  studentEmail: string;
  createdAt: number;
};

const STORAGE_KEY = "pending-booking-emails";
const MAX_ITEMS = 30;

function readQueue(): PendingBookingEmail[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingBookingEmail[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.queueId === "string" && typeof item.studentEmail === "string");
  } catch {
    return [];
  }
}

function writeQueue(items: PendingBookingEmail[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_ITEMS)));
  } catch {
    // Ignore storage errors on private browsing limits.
  }
}

export function enqueuePendingBookingEmail(queueId: string, studentEmail: string) {
  const normalizedQueueId = String(queueId || "").trim();
  const normalizedEmail = String(studentEmail || "").trim().toLowerCase();
  if (!normalizedQueueId || !normalizedEmail) return;

  const current = readQueue();
  const alreadyQueued = current.some((item) => item.queueId === normalizedQueueId);
  if (alreadyQueued) return;

  current.push({
    queueId: normalizedQueueId,
    studentEmail: normalizedEmail,
    createdAt: Date.now(),
  });
  writeQueue(current);
}

export function clearPendingBookingEmail(queueId: string) {
  const normalizedQueueId = String(queueId || "").trim();
  if (!normalizedQueueId) return;
  const current = readQueue();
  writeQueue(current.filter((item) => item.queueId !== normalizedQueueId));
}

export function getPendingBookingEmails(): PendingBookingEmail[] {
  return readQueue();
}
