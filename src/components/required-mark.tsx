/**
 * The asterisk on a required field, and the line that explains it.
 *
 * WCAG 3.3.2 asks a form to tell you which fields it will refuse to submit
 * without. `required` alone does not: it is announced by a screen reader but
 * invisible to everyone else, who finds out by pressing the button and being
 * bounced back. One convention, used everywhere, is cheaper to learn than a
 * per-form dialect — so this is the only mark in the product, and the rule
 * for using it is mechanical:
 *
 *   1. A field gets a `<RequiredMark />` in its label if, and only if, its
 *      input actually carries the `required` attribute. An optional field
 *      never carries one, and a marked field that submits empty is a bug.
 *   2. A form with at least one marked field carries exactly one
 *      `<RequiredLegend />`, so the star is explained on the page rather
 *      than assumed.
 *
 * The star itself is `aria-hidden`: a screen reader already says "required"
 * from the attribute, and hearing "star" as well is noise. The `sr-only`
 * twin exists for the case where the attribute is on a control the label is
 * not programmatically tied to.
 *
 * No copy catalogue is imported here on purpose. Guest-facing forms are
 * client components that must not pull five languages into the guest bundle
 * (see `scripts/check-guest-bundle.ts`), so the words arrive as a `labels`
 * prop from whoever already has the right locale. The owner-facing dashboard
 * is English-only and takes the defaults.
 */

export interface RequiredLabels {
  /** Read in place of the star, e.g. "(required)". */
  mark: string;
  /** The whole legend line, star included, e.g. "* required field". */
  legend: string;
}

/** The dashboard is English-only, so its forms need pass nothing. */
export const REQUIRED_LABELS_EN: RequiredLabels = {
  mark: "(required)",
  legend: "* required field",
};

export function RequiredMark({ label }: { label?: string }): React.ReactElement {
  return (
    <>
      <span aria-hidden="true">&nbsp;*</span>
      <span className="sr-only"> {label ?? REQUIRED_LABELS_EN.mark}</span>
    </>
  );
}

/**
 * One per form that has a marked field. `className` is the caller's, because
 * the same line sits on the cream dashboard, on a themed menu surface and
 * inside a dark drawer — and none of those share a muted-text token.
 */
export function RequiredLegend({
  label,
  className,
}: {
  label?: string;
  className?: string;
}): React.ReactElement {
  return (
    <p className={className ?? "mt-2 text-xs text-muted"}>{label ?? REQUIRED_LABELS_EN.legend}</p>
  );
}
