-- Configurable default landing page per role (fixes users whose role lacks
-- dashboard:view permission getting stuck on an "Unauthorized" dead-end page
-- after login). The frontend's post-login system-settings fetch will read
-- this via the current user's role to route to an accessible page instead.
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "defaultRoute" TEXT NOT NULL DEFAULT 'dashboard';
