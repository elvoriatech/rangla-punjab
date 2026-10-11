-- "Completed" for table reservations and catering requests (owner,
-- 2026-10-11): the guests came / the event was served.
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'completed';

ALTER TABLE "catering_requests" DROP CONSTRAINT "catering_requests_status_check";
ALTER TABLE "catering_requests" ADD CONSTRAINT "catering_requests_status_check"
  CHECK ("status" IN ('requested', 'confirmed', 'declined', 'cancelled', 'completed'));
