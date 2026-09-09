import { NextResponse } from "next/server";
import { requireAuth, checkAssignmentLimit } from "@/lib/api";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, profile } = auth;

  const result = await checkAssignmentLimit(user.id, profile.tier);

  return NextResponse.json({ success: true, data: result });
}
