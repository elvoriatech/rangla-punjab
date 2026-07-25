-- Plain additive migration — no destructive ops. Should always pass.
CREATE TABLE "widgets" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "widgets_name_idx" ON "widgets"("name");

ALTER TABLE "widgets" ADD COLUMN "description" TEXT;
