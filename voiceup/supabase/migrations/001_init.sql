-- ============================================
-- VoiceUp — Supabase Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
create table public.users (
  id uuid primary key default uuid_generate_v4(),
  auth_id uuid unique references auth.users(id) on delete cascade,
  name text not null,
  email text unique not null check (email ~* '@gehu\.ac\.in$'),
  roll_number text unique,
  department text,
  role text not null default 'student' check (role in ('student', 'admin', 'accused')),
  is_banned boolean default false,
  ban_expiry timestamptz,
  last_complaint_date date,
  created_at timestamptz default now(),
  check (role <> 'student' or roll_number is not null)
);

-- ============================================
-- COMPLAINTS TABLE
-- ============================================
create table public.complaints (
  id uuid primary key default uuid_generate_v4(),
  complainant_id uuid not null references public.users(id),  -- hidden from accused/admin UI
  accused_name text not null,
  accused_department text not null,
  accused_role text not null,
  incident_date date not null,
  description text not null,

  -- AI analysis fields (auto-filled by Groq)
  ai_is_valid boolean,
  ai_severity text check (ai_severity in ('Low', 'Medium', 'High')),
  ai_category text check (ai_category in ('Harassment', 'Academic', 'Infrastructure', 'Behaviour', 'Other')),
  ai_summary text,
  ai_rejection_reason text,

  -- Status
  status text default 'Pending' check (status in ('Pending', 'AI_Rejected', 'Approved', 'Fake')),

  created_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id)
);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id),
  complaint_id uuid references public.complaints(id),
  message text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

alter table public.users enable row level security;
alter table public.complaints enable row level security;
alter table public.notifications enable row level security;

-- Users: can read own profile
create policy "Users can read own profile"
  on public.users for select
  using (auth.uid() = auth_id);

-- Users: admin can read all
create policy "Admin can read all users"
  on public.users for select
  using (
    exists (
      select 1 from public.users
      where auth_id = auth.uid() and role = 'admin'
    )
  );

-- Complaints: student sees only own complaints (complainant_id hidden in SELECT)
create policy "Student sees own complaints"
  on public.complaints for select
  using (complainant_id = (
    select id from public.users where auth_id = auth.uid()
  ));

-- Complaints: admin sees all complaints but complainant_id is excluded via view
create policy "Admin sees all complaints"
  on public.complaints for select
  using (
    exists (
      select 1 from public.users
      where auth_id = auth.uid() and role = 'admin'
    )
  );

-- Complaints: student can insert own complaint
create policy "Student can insert complaint"
  on public.complaints for insert
  with check (complainant_id = (
    select id from public.users where auth_id = auth.uid()
  ));

-- Complaints: admin can update (approve/fake)
create policy "Admin can update complaint"
  on public.complaints for update
  using (
    exists (
      select 1 from public.users
      where auth_id = auth.uid() and role = 'admin'
    )
  );

-- Notifications: user sees own
create policy "User sees own notifications"
  on public.notifications for select
  using (user_id = (
    select id from public.users where auth_id = auth.uid()
  ));

-- ============================================
-- ADMIN VIEW (hides complainant_id from admin)
-- ============================================
create view public.complaints_admin_view as
  select
    id, accused_name, accused_department, accused_role,
    incident_date, description,
    ai_is_valid, ai_severity, ai_category, ai_summary, ai_rejection_reason,
    status, created_at, reviewed_at
  from public.complaints;

-- ============================================
-- SEED: Create admin user (update email below)
-- ============================================
-- After running this schema, register on the site with admin email,
-- then run this to promote them:
-- UPDATE public.users SET role = 'admin' WHERE email = 'admin@college.edu';
