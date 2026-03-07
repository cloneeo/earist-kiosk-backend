const ACTIVE_TICKETS_KEY = "earist.activeTickets";
const ACTIVE_TICKETS_CHANGED_EVENT = "earist-active-tickets-changed";

const canUseStorage = () => typeof window !== "undefined" && !!window.localStorage;

const emitActiveTicketsChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACTIVE_TICKETS_CHANGED_EVENT));
};

export const getActiveTicketIds = (): string[] => {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(ACTIVE_TICKETS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const setActiveTicketIds = (ticketIds: string[]) => {
  if (!canUseStorage()) return;

  const deduped = Array.from(new Set(ticketIds.map((id) => id.trim()).filter(Boolean)));
  window.localStorage.setItem(ACTIVE_TICKETS_KEY, JSON.stringify(deduped));
  emitActiveTicketsChanged();
};

export const addActiveTicketId = (ticketId: string) => {
  const normalized = ticketId.trim();
  if (!normalized) return;

  const current = getActiveTicketIds();
  if (current.includes(normalized)) return;

  setActiveTicketIds([...current, normalized]);
};

export const removeActiveTicketId = (ticketId: string) => {
  const normalized = ticketId.trim();
  if (!normalized) return;

  const next = getActiveTicketIds().filter((id) => id !== normalized);
  setActiveTicketIds(next);
};

export const clearActiveTickets = () => {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(ACTIVE_TICKETS_KEY);
  emitActiveTicketsChanged();
};

export const ACTIVE_TICKETS_EVENTS = {
  changed: ACTIVE_TICKETS_CHANGED_EVENT,
} as const;
