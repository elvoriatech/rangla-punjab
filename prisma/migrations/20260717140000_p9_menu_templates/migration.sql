-- P9: menu templates — platform-owned starter menus by cuisine. NOT a
-- tenant table (no tenant_id, no RLS): these are Elvoria's catalogue,
-- read during onboarding and cloned into a restaurant's draft. Content
-- is one JSONB tree (categories → items) validated in the app
-- (src/lib/menu-template-service.ts) — same "read as one unit" rationale
-- as venues.hours/branding.
CREATE TABLE menu_templates (
  id          text PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  cuisine     text NOT NULL,
  emoji       text NOT NULL DEFAULT '🍽',
  locale      text NOT NULL DEFAULT 'de',
  active      boolean NOT NULL DEFAULT true,
  sort_index  integer NOT NULL DEFAULT 0,
  content     jsonb NOT NULL DEFAULT '{}',
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);

-- Admin reads the full list; the onboarding/dashboard picker reads only
-- active ones. Grant the app role plain access — no RLS on this table.
GRANT SELECT, INSERT, UPDATE, DELETE ON menu_templates TO elvoria_app;
