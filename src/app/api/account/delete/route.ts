// src/app/api/account/delete/route.ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase/server";

const STORAGE_BUCKET = "briefs";

export async function DELETE() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = createServiceClient();

  const { data: files } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(user.id, { limit: 1000 });

  if (files?.length) {
    await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(files.map((file: { name: string }) => `${user.id}/${file.name}`));
  }

  const { error: profileDeleteError } = await supabase
    .from("profiles")
    .delete()
    .eq("id", user.id);

  if (profileDeleteError) {
    console.error("Profile delete failed:", profileDeleteError);
    return NextResponse.json(
      { success: false, error: "Failed to delete account data." },
      { status: 500 }
    );
  }

  const { error: authDeleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (authDeleteError) {
    console.error("Auth delete failed:", authDeleteError);
    return NextResponse.json(
      { success: false, error: "Failed to delete account." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: { deleted: true },
  });
}
