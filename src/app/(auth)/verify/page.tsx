import { redirect } from "next/navigation";

/** Bare /verify has nothing to show — the real destinations are the
 *  tokenized /verify/[token] links from email. Send strays to login. */
export default function VerifyIndexPage(): never {
  redirect("/login");
}
