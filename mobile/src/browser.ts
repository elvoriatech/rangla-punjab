import { Linking, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

/**
 * Opening a web page that is supposed to END BACK IN THE APP.
 *
 * Two flows need exactly this: paying (PayPal / hosted checkout returns
 * to `payment-return`) and signing in through the browser (the customer
 * callback returns to `auth-return`). `openAuthSessionAsync` is what
 * makes them feel like one flow: Custom Tabs on Android,
 * SFSafariViewController on iOS, and the tab closes ITSELF the moment
 * the page navigates to `returnUrl` — no app switching by hand.
 *
 * Resolves when the browser is gone, whether it returned on the deep
 * link or the guest dismissed it: callers use that as "look at the
 * server again now".
 */
export async function openReturningPage(url: string, returnUrl: string): Promise<void> {
  if (Platform.OS === "web") {
    await Linking.openURL(url);
    return;
  }
  try {
    await WebBrowser.openAuthSessionAsync(url, returnUrl);
  } catch {
    // No Custom Tabs provider / no SFSafariViewController: a plain in-app
    // browser still completes the flow, the guest just taps Done.
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      await Linking.openURL(url).catch(() => {});
    }
  }
}
