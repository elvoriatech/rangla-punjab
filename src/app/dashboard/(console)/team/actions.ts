"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/team-access";
import {
  createStaffMember,
  removeStaffMember,
  setStaffPassword,
  updateStaffMember,
} from "@/lib/team-service";

const path = "/dashboard/team";

function ticked(form: FormData): string[] {
  return form.getAll("perm").map(String);
}

/** Owner creates a login and ticks what it may open. */
export async function createStaffAction(form: FormData): Promise<void> {
  const userId = await requireOwner();
  const result = await createStaffMember(userId, {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
    permissions: ticked(form),
  });
  revalidatePath(path);
  redirect(result.ok ? `${path}?saved=created` : `${path}?error=${result.error}`);
}

export async function updateStaffAction(form: FormData): Promise<void> {
  const userId = await requireOwner();
  const result = await updateStaffMember(userId, String(form.get("id") ?? ""), {
    name: String(form.get("name") ?? ""),
    permissions: ticked(form),
  });
  revalidatePath(path);
  redirect(result.ok ? `${path}?saved=updated` : `${path}?error=${result.error}`);
}

export async function setStaffPasswordAction(form: FormData): Promise<void> {
  const userId = await requireOwner();
  const result = await setStaffPassword(
    userId,
    String(form.get("id") ?? ""),
    String(form.get("password") ?? ""),
  );
  revalidatePath(path);
  redirect(result.ok ? `${path}?saved=password` : `${path}?error=${result.error}`);
}

export async function removeStaffAction(form: FormData): Promise<void> {
  const userId = await requireOwner();
  const result = await removeStaffMember(userId, String(form.get("id") ?? ""));
  revalidatePath(path);
  redirect(result.ok ? `${path}?saved=removed` : `${path}?error=${result.error}`);
}
