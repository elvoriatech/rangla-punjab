import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { platformHealth } from "@/lib/health";
import { env } from "@/lib/env";
import { PLAN_CODES, PLANS } from "@/lib/plans";
import { SUPPORTED_CURRENCIES, SUPPORTED_LOCALES } from "@/lib/venue-service";
import pkg from "../../../../package.json";

/**
 * System — deliberately READ-ONLY. Infrastructure settings live in
 * environment variables and code (a web UI that can edit storage
 * credentials is an attack surface, not a feature); this page shows
 * what the running deployment is configured as, secrets masked.
 */

export default async function AdminSystemPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  if (!(await isPlatformAdmin(userId))) notFound();

  const health = await platformHealth();

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: "Application",
      rows: [
        ["Version", pkg.version],
        ["Public URL", env.APP_URL],
        ["Node env", process.env.NODE_ENV ?? "development"],
      ],
    },
    {
      title: "Plans",
      rows: PLAN_CODES.map((c) => [
        PLANS[c].label,
        `€${Math.round(PLANS[c].priceMonthlyCents / 100)}/mo`,
      ]),
    },
    {
      title: "Localisation (code-defined)",
      rows: [
        ["Menu languages", SUPPORTED_LOCALES.map((l) => l.code).join(", ")],
        ["Currencies", SUPPORTED_CURRENCIES.join(", ")],
      ],
    },
    {
      title: "Storage & media",
      rows: [["Images", "Local disk — public/uploads (resized on the fly by /img)"]],
    },
    {
      title: "Email",
      rows: [
        ["Transport", env.EMAIL_TRANSPORT],
        ["From", env.EMAIL_FROM],
      ],
    },
  ];

  return (
    <main className="px-6 py-10 lg:px-10">
      <header className="mx-auto max-w-4xl">
        <h1 className="font-serif text-3xl text-white">System</h1>
        <p className="mt-1 text-sm text-neutral-400">
          What this deployment is configured as. Read-only by design — infrastructure changes happen
          in the environment and in code review, never through a browser form.
        </p>
      </header>

      <section aria-label="Health" className="mx-auto mt-8 max-w-4xl">
        <h2 className="text-xs uppercase tracking-[0.2em] text-neutral-500">Live health</h2>
        <ul className="mt-3 flex flex-wrap gap-3 text-sm">
          {health.map((h) => (
            <li
              key={h.name}
              title={h.detail}
              className={`border px-3 py-1.5 ${
                h.ok ? "border-emerald-500/30 text-emerald-300" : "border-red-500/40 text-red-300"
              }`}
            >
              {h.ok ? "✔" : "✖"} {h.name}
            </li>
          ))}
        </ul>
      </section>

      {groups.map((g) => (
        <section key={g.title} aria-label={g.title} className="mx-auto mt-8 max-w-4xl">
          <h2 className="text-xs uppercase tracking-[0.2em] text-neutral-500">{g.title}</h2>
          <dl className="mt-3 border border-white/10 bg-white/[0.02]">
            {g.rows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 border-b border-white/5 px-5 py-3 last:border-b-0"
              >
                <dt className="text-xs uppercase tracking-[0.14em] text-neutral-500">{label}</dt>
                <dd className="break-all text-right font-mono text-xs text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </main>
  );
}
