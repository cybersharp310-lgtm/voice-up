# VoiceUp — Smart AI Complaint Management System
Built with: Supabase + Groq (Llama 3.1) + Vercel — Total cost: ₹0/month

---

## Project Structure
```
voiceup/
├── frontend/
│   ├── index.html       ← Login & Register
│   ├── student.html     ← Student dashboard
│   ├── form.html        ← File complaint (AI analyzed)
│   ├── admin.html       ← Admin review dashboard
│   ├── status.html      ← Complaint status tracker
│   ├── style.css        ← Shared styles
│   └── config.js        ← YOUR Supabase keys go here
├── supabase/
│   ├── functions/
│   │   ├── submit-complaint/index.ts   ← Main AI function
│   │   └── review-complaint/index.ts  ← Admin approve/ban
│   └── migrations/
│       └── 001_init.sql ← Run this first in Supabase
└── README.md
```

---

## Step 1 — Create Supabase Project (Free)
1. Go to https://supabase.com → New Project
2. Choose a name: "voiceup", pick a strong DB password
3. Wait ~2 minutes for setup
4. Go to SQL Editor → paste contents of `supabase/migrations/001_init.sql` → Run

---

## Step 2 — Get Your API Keys
1. Supabase Dashboard → Settings → API
2. Copy "Project URL" and "anon public" key
3. Paste them into `frontend/config.js`

---

## Step 3 — Get Free Groq API Key
1. Go to https://console.groq.com → Sign up free (no credit card)
2. Create API Key → copy it
3. You'll add this to Supabase secrets in Step 5

---

## Step 4 — Deploy Edge Functions
Install Supabase CLI first:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_ID
```

Set secrets:
```bash
supabase secrets set GROQ_API_KEY=your_groq_key_here
```

Deploy functions:
```bash
supabase functions deploy submit-complaint
supabase functions deploy review-complaint
```

---

## Step 5 — Deploy Frontend to Vercel (Free)
1. Push this project to GitHub
2. Go to https://vercel.com → Import project → select your repo
3. Set root directory to `frontend`
4. Deploy — done! You get a live URL instantly.

---

## Step 6 — Create Admin Account
1. Open your deployed site → Register with role "Admin"
2. Go to Supabase Dashboard → Table Editor → users table
3. Find your email → change `role` column from "student" to "admin"
4. Now login — you'll land on the admin dashboard

---

## How the AI Works
When a student submits a complaint:
1. Edge function sends the text to Groq (Llama 3.1 8B)
2. AI returns JSON: { isValid, severity, category, summary, rejectionReason }
3. If invalid → auto-rejected, reason shown to student
4. If valid → saved to DB with AI metadata, accused notified anonymously
5. Admin sees AI summary card — clicks Approve or Fake
6. Fake → 1-month ban auto-applied via DB update

---

## Free Tier Limits
| Service     | Free Limit              | Your Usage         |
|-------------|-------------------------|--------------------|
| Supabase    | 500MB DB, 50k users     | Well within limits |
| Groq        | 14,400 requests/day     | ~1 per complaint   |
| Vercel      | Unlimited deployments   | No limits          |
| EmailJS     | 200 emails/month        | Optional feature   |

---

## Tech Stack Summary
- Frontend: HTML + CSS + Vanilla JS (no framework needed)
- Auth: Supabase Auth (JWT tokens)
- Database: Supabase PostgreSQL with RLS policies
- Backend: Supabase Edge Functions (Deno runtime)
- AI: Groq Cloud API — Llama 3.1 8B Instant model
- Hosting: Vercel (auto-deploy from GitHub)
