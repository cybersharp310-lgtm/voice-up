// ============================================
// VoiceUp — review-complaint Edge Function
// Admin: approve or mark complaint as fake
// ============================================
// Deploy: supabase functions deploy review-complaint

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify admin identity
    const authHeader = req.headers.get("Authorization")!;
    const { data: { user } } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: adminProfile } = await supabase
      .from("users").select("*").eq("auth_id", user.id).single();

    if (!adminProfile || adminProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { complaintId, action } = await req.json(); // action: "approve" | "fake"

    if (!complaintId || !["approve", "fake"].includes(action)) {
      return new Response(JSON.stringify({ error: "complaintId and action (approve/fake) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch complaint to get complainant_id
    const { data: complaint } = await supabase
      .from("complaints").select("*").eq("id", complaintId).single();

    if (!complaint) return new Response(JSON.stringify({ error: "Complaint not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    if (action === "approve") {
      // ── Approve: update status + notify complainant ───────────
      await supabase.from("complaints").update({
        status: "Approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminProfile.id,
      }).eq("id", complaintId);

      await supabase.from("notifications").insert({
        user_id: complaint.complainant_id,
        complaint_id: complaintId,
        message: "Your complaint has been reviewed and approved. Action is being taken by the authority.",
      });

      // Notify accused that action is being taken
      const { data: accusedUser } = await supabase
        .from("users").select("id").ilike("name", `%${complaint.accused_name}%`).single();

      if (accusedUser) {
        await supabase.from("notifications").insert({
          user_id: accusedUser.id,
          complaint_id: complaintId,
          message: "The complaint against you has been reviewed and upheld by the authority. Please expect to be contacted through official channels.",
        });
      }

      return new Response(JSON.stringify({ success: true, status: "Approved" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "fake") {
      // ── Fake: update status + apply 1-month ban ───────────────
      await supabase.from("complaints").update({
        status: "Fake",
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminProfile.id,
      }).eq("id", complaintId);

      const banExpiry = new Date();
      banExpiry.setMonth(banExpiry.getMonth() + 1);

      await supabase.from("users").update({
        is_banned: true,
        ban_expiry: banExpiry.toISOString(),
      }).eq("id", complaint.complainant_id);

      await supabase.from("notifications").insert({
        user_id: complaint.complainant_id,
        complaint_id: complaintId,
        message: `Your complaint was marked as false by the authority. Your account has been restricted until ${banExpiry.toDateString()}. Filing false complaints is a violation of the platform policy.`,
      });

      return new Response(JSON.stringify({
        success: true,
        status: "Fake",
        banApplied: true,
        banExpiry: banExpiry.toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Internal server error", detail: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
