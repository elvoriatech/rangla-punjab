import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IssueSection, type IssueSectionState } from "./issue-section";
import { POST_ORDER_COPY } from "@/lib/i18n/post-order";

/**
 * The guest complaint section has three states and one banner, and every
 * one of them has to survive with JavaScript switched off. These render
 * the component the way the tracker test does — as a plain function, no
 * database, no server action — and pin the markup a no-JS guest depends
 * on: a real `<form>`, the hidden credential, the photo URL, and one
 * language per render.
 */

const noop = (): void => {};

const render = (
  state: IssueSectionState,
  locale: "en" | "de" | "es" | "it" | "ar",
  result?: string | null,
  opts: { compose?: boolean; liveTracking?: boolean } = {},
): string =>
  renderToStaticMarkup(
    IssueSection({
      locale,
      themeStyle: {},
      orderId: "ord_1",
      token: "tok en/123",
      timezone: "Europe/Berlin",
      state,
      result,
      action: noop,
      ...opts,
    })!,
  );

const canReport: IssueSectionState = {
  canReport: true,
  windowEndsAt: "2026-09-19T21:00:00.000Z",
  issue: null,
};

const closed: IssueSectionState = {
  canReport: false,
  windowEndsAt: "2026-09-19T21:00:00.000Z",
  issue: null,
};

const thread: IssueSectionState = {
  canReport: true,
  windowEndsAt: "2026-09-19T21:00:00.000Z",
  issue: {
    id: "iss_1",
    status: "answered",
    messages: [
      {
        id: "msg_1",
        author: "guest",
        body: "The curry arrived cold.",
        hasPhoto: true,
        createdAt: "2026-09-19T18:10:00.000Z",
      },
      {
        id: "msg_2",
        author: "restaurant",
        body: "So sorry — we are sending a fresh one.",
        hasPhoto: false,
        createdAt: "2026-09-19T18:20:00.000Z",
      },
    ],
  },
};

describe("guest issue section", () => {
  it("offers a no-JS report form inside the window", () => {
    const html = render(canReport, "en");
    expect(html).toContain('id="issue"');
    expect(html).toContain(POST_ORDER_COPY.en.issue.title);
    expect(html).toContain('name="body"');
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    // The credential and the language travel with the post — without JS
    // there is nothing else to carry them.
    expect(html).toContain('name="token"');
    expect(html).toContain('value="tok en/123"');
    expect(html).toContain('name="locale"');
    expect(html).toContain(POST_ORDER_COPY.en.issue.send);
  });

  it("renders the thread with token-gated photos and a reply box", () => {
    const html = render(thread, "en");
    expect(html).toContain("The curry arrived cold.");
    expect(html).toContain("So sorry — we are sending a fresh one.");
    expect(html).toContain(POST_ORDER_COPY.en.issue.statusLabels.answered);
    // Photo goes through the gated route, with the token URL-encoded and
    // an alt that says who sent it.
    expect(html).toContain("/api/v1/orders/ord_1/issue/photo/msg_1?token=tok%20en%2F123");
    expect(html).toContain(`alt="${POST_ORDER_COPY.en.issue.photoAlt("You")}"`);
    expect(html).toContain(POST_ORDER_COPY.en.issue.replySend);
    // Only the message that has one gets an image.
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it("locks a resolved thread read-only", () => {
    const html = render({ ...thread, issue: { ...thread.issue!, status: "resolved" } }, "en");
    expect(html).toContain(POST_ORDER_COPY.en.issue.resolvedNote);
    expect(html).not.toContain('name="body"');
    expect(html).toContain(POST_ORDER_COPY.en.issue.statusLabels.resolved);
  });

  it("says the window closed instead of showing a form", () => {
    const html = render(closed, "de");
    expect(html).toContain(POST_ORDER_COPY.de.issue.windowClosed);
    expect(html).not.toContain('name="body"');
  });

  it("turns ?issue= into one line, in the page's language", () => {
    const sent = render(canReport, "it", "sent");
    expect(sent).toContain(POST_ORDER_COPY.it.issue.sent);
    expect(sent).toContain('role="status"');
    const tooLarge = render(canReport, "es", "too_large");
    expect(tooLarge).toContain(POST_ORDER_COPY.es.issue.errors.tooLarge);
    expect(tooLarge).toContain('role="alert"');
    // An unknown code still says something useful rather than nothing.
    // (The English line carries an apostrophe React escapes, so the
    // assertion takes the tail of it.)
    expect(render(canReport, "en", "boom")).toContain("go through — please try again.");
  });

  it("hides the composer behind a link while the tracker is refreshing", () => {
    // A 15-second meta refresh would wipe a half-typed complaint, so an
    // order still in progress offers a link instead of a box.
    const live = render(canReport, "en", null, { liveTracking: true });
    expect(live).not.toContain('name="body"');
    expect(live).toContain(POST_ORDER_COPY.en.issue.reportLink);
    expect(live).toContain("compose=1#issue");
    // …and nothing that contradicts it: the window is open, that is why
    // the link is there.
    expect(live).not.toContain(POST_ORDER_COPY.en.issue.windowClosed);
    const liveDe = render(canReport, "de", null, { liveTracking: true });
    expect(liveDe).toContain(POST_ORDER_COPY.de.issue.reportLink);
    expect(liveDe).not.toContain(POST_ORDER_COPY.de.issue.windowClosed);
    // An open thread says "reply" rather than "report".
    const liveThread = render(thread, "en", null, { liveTracking: true });
    expect(liveThread).toContain(POST_ORDER_COPY.en.issue.replyLink);
    // …and the messages themselves are there either way.
    expect(liveThread).toContain("The curry arrived cold.");
  });

  it("opens the box on ?compose=1 and says tracking is paused", () => {
    const composing = render(canReport, "en", null, { liveTracking: true, compose: true });
    expect(composing).toContain('name="body"');
    expect(composing).toContain(POST_ORDER_COPY.en.issue.pausedNote);
    // The way back drops `compose`, which is what restarts the refresh.
    expect(composing).toContain(POST_ORDER_COPY.en.issue.backToTracking);
    expect(composing).toContain(
      'href="/order-status/ord_1?token=tok+en%2F123&amp;locale=en#issue"',
    );
  });

  it("opens the box directly on a finished order — nothing to pause", () => {
    const done = render(canReport, "en", null, { liveTracking: false });
    expect(done).toContain('name="body"');
    expect(done).not.toContain(POST_ORDER_COPY.en.issue.pausedNote);
    expect(done).not.toContain(POST_ORDER_COPY.en.issue.reportLink);
  });

  it("renders Arabic right-to-left, with no other language leaking in", () => {
    const html = render(thread, "ar");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(POST_ORDER_COPY.ar.issue.threadTitle);
    expect(html).toContain(POST_ORDER_COPY.ar.issue.replySend);
    for (const stray of [
      POST_ORDER_COPY.en.issue.replySend,
      POST_ORDER_COPY.de.issue.replySend,
      POST_ORDER_COPY.en.issue.threadTitle,
    ]) {
      expect(html, `${stray} leaked into the Arabic render`).not.toContain(stray);
    }
  });
});
