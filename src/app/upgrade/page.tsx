import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import UpgradePricing, { type ViewerTier } from "./upgrade-pricing";

export default async function UpgradePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let currentTier: ViewerTier = "anonymous";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", user.id)
      .single();
    currentTier = profile?.tier ?? "free";
  }
  return (
    <Suspense fallback={null}>
      <UpgradePricing currentTier={currentTier} />
    </Suspense>
  );
}

