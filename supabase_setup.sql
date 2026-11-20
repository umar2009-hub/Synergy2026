-- ====================================================
-- FAREWELL VERIFICATION SYSTEM - SUPABASE SCHEMA SETUP
-- Paste this script into your Supabase SQL Editor and run it.
-- ====================================================

-- 1. Create 'students' table
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    name TEXT NOT NULL,
    roll_no TEXT,
    stud_id TEXT,
    program TEXT DEFAULT 'BTech',
    year INT DEFAULT 2,
    section TEXT DEFAULT 'A',
    payment_status TEXT DEFAULT 'Paid',
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    verified_by TEXT
);

-- 2. Create 'admins' table
CREATE TABLE IF NOT EXISTS public.admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    name TEXT NOT NULL,
    pin TEXT NOT NULL,
    role TEXT DEFAULT 'sub', -- 'master' or 'sub'
    gate TEXT DEFAULT 'Gate-1',
    is_active BOOLEAN DEFAULT true
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies allowing the anon client to read and update
-- (Adjust or restrict if you want stricter security rules)
CREATE POLICY "Allow anon read students" ON public.students
    FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anon insert students" ON public.students
    FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon update students" ON public.students
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon read admins" ON public.admins
    FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anon insert admins" ON public.admins
    FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon update admins" ON public.admins
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- 5. Enable Realtime Replication for live synchronization
ALTER PUBLICATION supabase_realtime ADD TABLE public.students;
ALTER PUBLICATION supabase_realtime ADD TABLE public.admins;

-- 6. Insert Default Initial Master Admin (PIN: 22568)
INSERT INTO public.admins (name, pin, role, gate, is_active)
VALUES ('Master Admin', '22568', 'master', 'All Gates', true)
ON CONFLICT DO NOTHING;
