import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveChangesButton } from "./save-changes-button";

/**
 * Server render = a freshly loaded settings form, which is pristine by
 * definition: Save must start disabled and say why. (The client-side
 * dirty tracking is plain DOM `input`/`change` listeners on the form.)
 */
describe("SaveChangesButton", () => {
  it("renders disabled with an explanatory title until the form changes", () => {
    const html = renderToStaticMarkup(
      <form>
        <input name="secret" />
        <SaveChangesButton pendingLabel="Saving…">Save payment keys</SaveChangesButton>
      </form>,
    );
    expect(html).toMatch(/<button[^>]*\bdisabled\b/);
    expect(html).toContain("Nothing to save yet");
    expect(html).toContain("Save payment keys");
  });
});
