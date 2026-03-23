// ============================================
// VoiceUp — submit-complaint Edge Function
// Supabase Edge Functions (Deno runtime)
// ============================================
// Deploy: supabase functions deploy submit-complaint

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Groq AI Analysis ──────────────────────────────────────────────
async function analyzeComplaintWithGroq(description: string, accusedRole: string) {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;

  const prompt = `You are a complaint validation system for a college. Analyze the following complaint and return ONLY a valid JSON object with no extra text.

Complaint: "${description}"
Accused role: "${accusedRole}"

Return this exact JSON structure:
{
  "isValid": true or false,
  "severity": "Low" or "Medium" or "High",
  "category": "Harassment" or "Academic" or "Infrastructure" or "Behaviour" or "Other",
  "summary": "A 1-2 sentence neutral summary of the complaint",
  "rejectionReason": "Reason if invalid, else null"
}

Rules:
- isValid = false if the text is gibberish, random characters, too short (<20 words), or clearly fake/spam
- severity High = threats, harassment, discrimination, serious academic fraud
- severity Medium = repeated misbehaviour, unfair treatment, policy violations
- severity Low = minor issues, single incidents, infrastructure problems
- summary must be neutral — do not reveal complainant identity
- rejectionReason must explain why in one sentence if isValid is false`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      max_tokens: 300,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  const raw = data.choices[0].message.content.trim();

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Main Handler ──────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get authenticated user
    const authHeader = req.headers.get("Authorization")!;
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user profile
    const { data: profile } = await supabase
      .from("users")
      .select("*")
      .eq("auth_id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "User profile not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Check ban ──────────────────────────────────────────────
    if (profile.is_banned) {
      const banExpiry = new Date(profile.ban_expiry);
      if (banExpiry > new Date()) {
        return new Response(JSON.stringify({
          error: "banned",
          message: `Your account is banned until ${banExpiry.toDateString()} due to a false complaint.`,
          banExpiry: profile.ban_expiry,
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        // Ban expired — lift it automatically
        await supabase.from("users").update({ is_banned: false, ban_expiry: null }).eq("id", profile.id);
      }
    }

    // ── Check 1-complaint-per-day limit ───────────────────────
    const today = new Date().toISOString().split("T")[0];
    if (profile.last_complaint_date === today) {
      return new Response(JSON.stringify({
        error: "limit_reached",
        message: "You can only file 1 complaint per day. Try again tomorrow.",
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Parse request body ─────────────────────────────────────
    const { accusedName, accusedDepartment, accusedRole, incidentDate, description } = await req.json();

    if (!accusedName || !accusedDepartment || !accusedRole || !incidentDate || !description) {
      return new Response(JSON.stringify({ error: "All fields are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Groq AI Analysis ───────────────────────────────────────
    const ai = await analyzeComplaintWithGroq(description, accusedRole);

    // ── Insert complaint ───────────────────────────────────────
    const { data: complaint, error: insertError } = await supabase
      .from("complaints")
      .insert({
        complainant_id: profile.id,
        accused_name: accusedName,
        accused_department: accusedDepartment,
        accused_role: accusedRole,
        incident_date: incidentDate,
        description,
        ai_is_valid: ai.isValid,
        ai_severity: ai.isValid ? ai.severity : null,
        ai_category: ai.isValid ? ai.category : null,
        ai_summary: ai.isValid ? ai.summary : null,
        ai_rejection_reason: !ai.isValid ? ai.rejectionReason : null,
        status: ai.isValid ? "Pending" : "AI_Rejected",
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // ── Update last complaint date ─────────────────────────────
    await supabase.from("users").update({ last_complaint_date: today }).eq("id", profile.id);

    // ── Notify accused (if they have an account) ───────────────
    if (ai.isValid) {
      const { data: accusedUser } = await supabase
        .from("users")
        .select("id")
        .ilike("name", `%${accusedName}%`)
        .single();

      if (accusedUser) {
        await supabase.from("notifications").insert({
          user_id: accusedUser.id,
          complaint_id: complaint.id,
          message: `A complaint regarding your conduct (${ai.category}) has been filed and is under review. Your personal contact information has not been shared.`,
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      complaintId: complaint.id,
      status: complaint.status,
      aiResult: {
        isValid: ai.isValid,
        severity: ai.severity,
        category: ai.category,
        summary: ai.summary,
        rejectionReason: ai.rejectionReason,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Internal server error", detail: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
