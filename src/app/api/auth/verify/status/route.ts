import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Session-scoped "am I verified yet?" — polled by the onboarding
 *  verify gate so the screen advances the moment the owner clicks the
 *  link in their inbox (often in another tab). No user input, no
 *  enumeration surface: it only ever reports on the caller's session. */
export async function GET(): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ verified: false }, { status: 401 });
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { emailVerifiedAt: true },
  });
  return NextResponse.json({ verified: Boolean(user?.emailVerifiedAt) });
}
