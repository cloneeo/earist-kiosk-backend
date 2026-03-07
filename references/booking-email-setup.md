# Booking Email Setup

Booking confirmation email is triggered by `POST /api/booking/email` when `QueueConfirmation` loads.

## Required environment variables

Set these in your environment (or `.env`):

- `SMTP_HOST` - SMTP host (for Gmail: `smtp.gmail.com`)
- `SMTP_PORT` - SMTP port (usually `587` or `465`)
- `SMTP_USER` - SMTP username/login email
- `SMTP_PASS` - SMTP password (for Gmail: App Password)
- `BOOKING_EMAIL_FROM` - Sender address, usually same as `SMTP_USER`
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Recommended for server-side email lookup (bypasses RLS for `students` reads)
- `VITE_API_BASE_URL` - Backend server origin when frontend runs separately (e.g., `http://localhost:3000`)

## How recipient is resolved

The endpoint looks up the queue ticket, then reads student email from `students` table using `student_number`.
Accepted columns:

- `email`
- `student_email`

If no email exists for the student, email dispatch is skipped.

Note: If `SUPABASE_SERVICE_ROLE_KEY` is missing, the route falls back to anon key, which may fail when RLS blocks `students` table reads.

If the frontend runs with Vite only (no integrated Express server), `/api/booking/email` on the frontend origin returns 404. Set `VITE_API_BASE_URL` to your backend origin and ensure backend is running.

For Gmail SMTP, enable 2FA and use a Google App Password in `SMTP_PASS`.

## Route behavior

- Success: `{ ok: true }`
- Skipped (not configured / missing student email): `{ ok: false, skipped: true, message: "..." }`
