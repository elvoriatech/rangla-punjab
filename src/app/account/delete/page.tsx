import { redirect } from "next/navigation";

/**
 * The "delete your account" address the app stores ask for. The feature
 * itself lives on the account page (sign in, then the delete section at
 * the bottom); this path only opens that page with the section explained.
 */
export default function DeleteAccountPage(): never {
  redirect("/account?delete=1#konto-loeschen");
}
