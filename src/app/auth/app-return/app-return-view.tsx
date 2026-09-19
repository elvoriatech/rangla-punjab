import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { postOrderCopy } from "@/lib/i18n/post-order";
import { dirFor, uiLocale } from "@/lib/locales";

/**
 * The hand-over page's whole render, kept separate from the async page so
 * it can be asserted directly: the ONE thing that matters here is that a
 * URL which is not an app deep link never reaches the markup.
 *
 * `to` is the raw query value on purpose — the sanitizer lives inside the
 * component, so there is no way to render this with an unchecked link.
 */
export function AppReturnView({
  to,
  locale: localeCode,
  venueName,
}: {
  to: string | null | undefined;
  locale: string;
  venueName: string | null;
}): React.ReactElement {
  const deepLink = sanitizeAppReturnUrl(to);
  const locale = uiLocale(localeCode);
  const t = postOrderCopy(locale);

  return (
    <>
      {/* Three ways back, cheapest first: the meta refresh fires before
          any JS runs (and works with JS off), `location.replace` catches
          browsers that ignore a refresh to a custom scheme, and the
          button is there for the guest when both are blocked. */}
      {deepLink ? <meta httpEquiv="refresh" content={`0;url=${deepLink}`} /> : null}
      <main
        dir={dirFor(locale)}
        className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-cream px-6 py-16 text-center text-ink"
      >
        {venueName ? (
          <p className="text-xs uppercase tracking-[0.28em] rtl:normal-case rtl:tracking-normal text-gold-dark">
            {venueName}
          </p>
        ) : null}
        <h1 className="mt-2 font-serif text-3xl leading-tight">{t.signedIn}</h1>
        {deepLink ? (
          <a
            href={deepLink}
            className="mt-6 block w-full bg-orange px-4 py-3.5 text-center text-sm font-semibold uppercase tracking-[0.18em] rtl:normal-case rtl:tracking-normal text-card transition hover:bg-orange-dark"
          >
            {t.backToApp}
          </a>
        ) : null}
        <p className="mt-4 text-sm text-muted">{t.closeWindow}</p>
      </main>
      {deepLink ? (
        <script
          // The link is already allow-listed to app schemes; JSON-encoding
          // it (with `<` escaped) is what keeps it a string literal rather
          // than a way out of the script element.
          dangerouslySetInnerHTML={{
            __html: `location.replace(${JSON.stringify(deepLink).replace(/</g, "\\u003c")})`,
          }}
        />
      ) : null}
    </>
  );
}
