# Benchmark

A mobile-first construction project management tool for a residential home
builder (JABRO). Two roles: an **OWNER** who reads a dashboard, and a
**MANAGER** (field superintendent) who updates job progress from a phone.

This is the foundation step: project setup, Supabase connection, auth, the app
shell, and a dashboard. Feature screens come in later steps.

## Stack

- Vite + React + TypeScript
- Tailwind CSS v3
- react-router-dom v6
- @supabase/supabase-js v2
- No component library — hand-rolled Tailwind components

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local env file and fill in your Supabase credentials:

   ```bash
   cp .env.local.example .env.local
   ```

   Then edit `.env.local` and set both values (from the Supabase dashboard →
   Project Settings → API):

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```

   > The app reads these at startup and throws a clear error if either is
   > missing. `.env.local` is git-ignored; `.env.local.example` is committed as
   > documentation.

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Vite prints a local URL (default http://localhost:5173).

There is **no public signup** — create users in the Supabase dashboard
(Authentication → Users), and add a matching row in `profiles` with the user's
`id`, `full_name`, and `role` (`owner` or `manager`).

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — typecheck (`tsc -b`) and build for production
- `npm run preview` — preview the production build

## Data model

These tables already exist in Supabase (the app only types/queries them — it
does not create them):

- `profiles(id, full_name, role['owner'|'manager'])`
- `projects(id, name, type['new_build'|'renovation'], status, client_name,
  address, total_amount, start_date, target_completion_date, baseline_locked_at,
  notes, created_at)`

## File structure created

```
benchmark/
├── .env.local                  # your Supabase creds (git-ignored, fill in)
├── .env.local.example          # documents the required env vars
├── tailwind.config.js          # Tailwind v3 config + amber/charcoal theme
├── postcss.config.js           # Tailwind + autoprefixer
├── index.html                  # title set to "Benchmark"
└── src/
    ├── index.css               # Tailwind directives + base styles
    ├── main.tsx                # React entry
    ├── App.tsx                 # AuthProvider + router (routes below)
    ├── lib/
    │   ├── supabase.ts         # singleton Supabase client from env vars
    │   └── types.ts            # Profile / Project TypeScript interfaces
    ├── context/
    │   └── AuthContext.tsx      # session, profile (+role), loading, signOut()
    ├── components/
    │   ├── ProtectedRoute.tsx   # redirects to /login when no session
    │   ├── Layout.tsx           # top bar (wordmark, user name, sign out)
    │   └── NewProjectModal.tsx  # create-project modal form
    └── pages/
        ├── Login.tsx           # email + password sign-in
        └── Dashboard.tsx       # New Builds / Renovations sections + cards
```

### Routes

- `/login` → `Login`
- `/` → `Dashboard` (protected, wrapped in `Layout`)
- `/project/:id` → cards link here; the route is a stub for a later step.

## How to verify (acceptance)

1. **Dev server:** `npm run dev` serves the app at the printed local URL.
2. **Login:** sign in with your Supabase user. Wrong email/password shows
   "Incorrect email or password."
3. **Dashboard:** after login you land on `/` with two sections — "New Builds"
   and "Renovations" — each showing a friendly empty state at first.
4. **Create:** click "+ New Build", fill in at least a name, submit. A card
   appears under New Builds and persists after a page refresh (it's stored in
   Supabase). Same for "+ Renovation".
5. **Sign out:** the "Sign out" button in the top bar returns you to `/login`.

## Design

- Accent/primary: amber `#C2740C`; text charcoal `#1F2937`; neutral gray
  backgrounds.
- Mobile-first: ~44px tap targets, readable type, comfortable at ~380px wide.
- App data relies on the Supabase session — no `localStorage`/`sessionStorage`.
