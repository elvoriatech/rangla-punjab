import { MessagePopup } from "./message-popup";

/**
 * Server-side wrapper for MessagePopup used by pages that surface a
 * message from searchParams after a redirect. The changing key forces a
 * fresh mount on every server render: without it, a popup dismissed once
 * would stay dismissed when the SAME message text arrives again (React
 * preserves client-component state across prop-equal RSC re-renders).
 */
export function FlashMessage({
  kind,
  text,
}: {
  kind: "success" | "error";
  text: string;
}): React.ReactElement {
  // eslint-disable-next-line react-hooks/purity -- deliberate remount nonce; see doc comment
  return <MessagePopup key={Date.now()} kind={kind} text={text} />;
}
