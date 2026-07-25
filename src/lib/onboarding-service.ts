import { z } from "zod";
import { asUser } from "./tenant";
import { checkContrast } from "./contrast";

/**
 * Venue-materialization primitive. The public self-serve onboarding wizard
 * was removed (P4-2) — provisioning is operator-only now — but the staged
 * state → `venues` row logic is kept as the internal building block that
 * provisioning and the integration tests share. Each step call takes the
 * userId, accumulates into the tenant's `onboarding_state` JSON, and the
 * final "complete" call materialises the `venues` row + a draft menu.
 *
 * Steps are idempotent — calling a step twice writes the same shape.
 */

export type ImportBranch = "manual";

export const STEP_1_MAX = 80;
export const STEP_3_COLOR = /^#([0-9a-fA-F]{6})$/;

export interface OnboardingState {
  step: 1 | 2 | 3 | 4;
  venueName?: string;
  importBranch?: ImportBranch;
  primaryColor?: string; // hex, e.g. "#1f3b2e"
  logoKey?: string; // storage-key stub; real upload in P1-14
}

/** Shape saved into `Tenant.onboarding_state` — permissive so future
 * columns don't require a migration. */
const stateSchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  venueName: z.string().min(1).max(STEP_1_MAX).optional(),
  importBranch: z.literal("manual").optional(),
  primaryColor: z.string().regex(STEP_3_COLOR).optional(),
  logoKey: z.string().min(1).max(512).optional(),
});

export async function getOnboardingState(userId: string): Promise<{
  state: OnboardingState;
  completed: boolean;
}> {
  return asUser(userId, async (tx) => {
    const tenant = await tx.tenant.findFirstOrThrow({
      select: { onboardingState: true, onboardingCompletedAt: true },
    });
    const parsed = stateSchema.safeParse(tenant.onboardingState);
    const state: OnboardingState = parsed.success ? parsed.data : { step: 1 };
    return { state, completed: tenant.onboardingCompletedAt != null };
  });
}

export const step1Schema = z.object({
  venueName: z.string().trim().min(1).max(STEP_1_MAX),
});
export const step2Schema = z.object({ importBranch: z.literal("manual") });
export const step3Schema = z.object({
  primaryColor: z.string().regex(STEP_3_COLOR, "primary colour must be #rrggbb"),
  // Logo upload is stubbed until P1-14. Accept an opaque storage-key string
  // for now — the wizard just remembers what the user picked.
  logoKey: z.string().min(1).max(512).optional(),
});

export interface SaveStepResult {
  ok: boolean;
  error?: string;
  /** Populated when a rejection has a machine-actionable next hex to
   * suggest (currently step 3's contrast guard). */
  suggestion?: string;
}

export async function saveStep1(
  userId: string,
  input: z.infer<typeof step1Schema>,
): Promise<SaveStepResult> {
  return updateState(userId, (state) => ({ ...state, ...input, step: max(state.step, 2) }));
}

export async function saveStep2(
  userId: string,
  input: z.infer<typeof step2Schema>,
): Promise<SaveStepResult> {
  return updateState(userId, (state) => ({ ...state, ...input, step: max(state.step, 3) }));
}

export async function saveStep3(
  userId: string,
  input: z.infer<typeof step3Schema>,
): Promise<SaveStepResult> {
  // Contrast guard: brand colour must be legible on our cream background.
  // AA-normal (4.5:1) is the CLAUDE.md bar for public menu pages, and the
  // wizard rejects anything that would silently ship a broken theme. When
  // the picked colour fails, the guard also returns the nearest passing
  // shade (same hue/saturation, lightness walked toward black) so the UI
  // can offer a one-click nudge.
  const check = checkContrast(input.primaryColor, "#faf7f2");
  if (!check.ok) {
    return {
      ok: false,
      error: `primary colour fails WCAG AA (${check.ratio.toFixed(2)}:1 < 4.5:1) against the cream background`,
      ...(check.suggestion ? { suggestion: check.suggestion } : {}),
    };
  }
  return updateState(userId, (state) => ({ ...state, ...input, step: max(state.step, 4) }));
}

/**
 * Complete onboarding: create the venue from the accumulated state, stamp
 * `onboarding_completed_at`. Idempotent — a second call is a no-op if the
 * timestamp is already set.
 */
export async function completeOnboarding(userId: string): Promise<SaveStepResult> {
  return asUser(userId, async (tx) => {
    const tenant = await tx.tenant.findFirstOrThrow({
      select: { id: true, onboardingState: true, onboardingCompletedAt: true },
    });
    if (tenant.onboardingCompletedAt) return { ok: true };

    const parsed = stateSchema.safeParse(tenant.onboardingState);
    if (!parsed.success || !parsed.data.venueName || !parsed.data.primaryColor) {
      return { ok: false, error: "onboarding is incomplete" };
    }
    const slug = venueSlug(parsed.data.venueName, tenant.id);

    const venue = await tx.venue.create({
      data: {
        tenantId: tenant.id,
        name: parsed.data.venueName,
        slug,
        // Enable German alongside English by default — the Guesto launch
        // market is Central Europe. Owners tune this list from Settings
        // later (P1-11 covers the render + URL surface, not the picker).
        enabledLocales: ["en", "de"],
        branding: { primaryColor: parsed.data.primaryColor, logoKey: parsed.data.logoKey ?? null },
      },
    });
    // Provision the default menu + a draft version so category CRUD (P1-5)
    // has something to hang off. P1-7 will layer the publish workflow on
    // top of these same rows — nothing here is throw-away.
    const menu = await tx.menu.create({
      data: { tenantId: tenant.id, venueId: venue.id, name: "Main menu", isDefault: true },
    });
    await tx.menuVersion.create({
      data: { tenantId: tenant.id, menuId: menu.id, status: "draft" },
    });
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { onboardingCompletedAt: new Date() },
    });
    return { ok: true };
  });
}

// ---------- helpers ----------

async function updateState(
  userId: string,
  patch: (state: OnboardingState) => OnboardingState,
): Promise<SaveStepResult> {
  return asUser(userId, async (tx) => {
    const tenant = await tx.tenant.findFirstOrThrow({
      select: { id: true, onboardingState: true },
    });
    const parsed = stateSchema.safeParse(tenant.onboardingState);
    const current: OnboardingState = parsed.success ? parsed.data : { step: 1 };
    const next = patch(current);
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { onboardingState: next as unknown as object },
    });
    return { ok: true };
  });
}

function max<T extends number>(a: T, b: T): T {
  return (a > b ? a : b) as T;
}

/** Slug: lowercased venue name + short tenant suffix so two tenants named
 * "Volpe" don't collide on the `venues.slug` unique index. */
function venueSlug(name: string, tenantId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = tenantId.slice(0, 8);
  return `${base}-${suffix}`;
}
