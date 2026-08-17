# Jadyn's Pattern Manager

A private, installable web app for a two-person household. It combines a searchable pattern library, project tracker, and PDF workbench with persistent row counters, notes, checks, stickers, highlights, and “stopped here” guides.

The React app is designed for Netlify. Supabase provides invitation-only login, Postgres data, row-level security, and private file storage.

## What is included

- Search, filter, favorite, add, and edit patterns.
- Separate personal settings for each account.
- Track crochet, knit, sewing, quilting, embroidery, art, DIY, or any other creative project.
- Link a project to a catalog pattern or keep it standalone.
- Project progress, status, dates, materials/colorway, checklists, and journal entries.
- A private PDF reader with zoom, page memory, project-specific annotations, stickers, row guides, and multiple counters.
- Offline-safe mutation queue for annotation, counter, and reader-state retries.
- Local, resumable importer for the existing private catalog.
- PWA installation and responsive desktop/mobile layouts.
- Database-enforced two-user membership and private Storage policies.

## Privacy model

The GitHub/Netlify bundle contains no catalog export, PDF, thumbnail, email address, or secret. Browser code receives only the Supabase project URL and publishable key; every database row and file request is authorized by Supabase Row Level Security.

Exactly two active household members and one owner are enforced in the database. Disabling public sign-up is an additional Auth setting—not the only security boundary.

See [docs/SECURITY.md](docs/SECURITY.md) for the complete security and backup notes.

## Preview locally

```powershell
npm install
npm run dev
```

With no `.env` file, the app opens a local demo library. Demo changes are saved only in that browser. Run all checks with:

```powershell
npm run check
```

## Production setup

### 1. Create the Supabase foundation

1. Create a new Supabase project.
2. Open **SQL Editor** and run [supabase/migrations/202608150001_initial_pattern_manager.sql](supabase/migrations/202608150001_initial_pattern_manager.sql).
3. Copy the project URL and publishable key for the Netlify step. Do not invite accounts until the production callback URL exists.

### 2. Connect Netlify

1. In Netlify, choose **Add new site → Import an existing project** and select this repository.
2. Netlify reads the build settings from `netlify.toml`.
3. Add these environment variables for production:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
VITE_APP_NAME=Jadyn's Pattern Manager
VITE_MAX_UPLOAD_MB=125
VITE_DEMO_MODE=false
```

Never add `SUPABASE_SERVICE_ROLE_KEY` to Netlify. The website does not need it.

### 3. Connect the two private accounts

1. After Netlify has its permanent HTTPS address, open **Supabase → Authentication → URL Configuration**.
2. Set the Site URL to that exact Netlify origin and add exactly `https://YOUR-SITE.netlify.app/auth/callback` as a redirect URL.
3. In **Authentication → Users**, invite only the two household accounts.
4. Copy their Auth user UUIDs into a private copy of [supabase/seed.example.sql](supabase/seed.example.sql), replace all three `NULL` placeholders, and run the entire block in one SQL Editor action.
5. In Auth settings, disable new-user sign-up, anonymous sign-in, unused providers, and manual identity linking.
6. Run [supabase/validation/001_initial_schema_checks.sql](supabase/validation/001_initial_schema_checks.sql).
7. Both people can now accept the invitations and use the app's email-link sign-in. Password sign-in is optional.

Do not put the two email addresses, passwords, UUIDs, or service key in Git.

### 4. Import the existing catalog privately

The importer is deliberately local and performs a read-only dry run unless `--apply` is present. Keep its service credential only in the current terminal session.

```powershell
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_LOCAL_SERVICE_ROLE_KEY"

npm run catalog:import -- `
  --catalog "D:\private\catalog_data.json" `
  --manifest "D:\private\library_manifest.json" `
  --asset-root "D:\private\Digital Patterns" `
  --household-id "YOUR-HOUSEHOLD-UUID" `
  --assets primary,thumbnails `
  --dry-run
```

Review the safe report path printed by the command, then repeat with `--apply --resume`. The tool:

- preserves stable `PAT-` identifiers;
- strips local paths and signed/private query parameters;
- uploads private primary instructions and thumbnails;
- deduplicates assets by SHA-256;
- resumes interrupted work;
- avoids overwriting user-modified imported records; and
- writes its report outside the repository by default.

The dry run warns when any private asset exceeds 50 MiB. Make sure the chosen Supabase project accepts every reported upload size, or compress those files before the applied import. The private bucket itself is capped at 125 MB per object by this migration.

The service role key bypasses RLS. Remove it from the terminal after the import:

```powershell
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

## Important operating rules

- Invite accounts through Supabase; do not add public account creation to the app.
- Keep pattern PDFs in private Storage. A free download is not permission to redistribute publicly.
- The original PDF remains unchanged. Annotations are separate project records.
- Use a separate Supabase project for deploy previews instead of wildcarding production redirects.
- Back up Postgres and Storage separately; Supabase database backups do not include Storage files.
- Use email-link sign-in unless you deliberately configure passwords. Add an in-app enrollment and challenge flow before requiring MFA.

## Main commands

```text
npm run dev              local app
npm run test             automated tests
npm run lint             code checks
npm run build            production build
npm run check            tests + lint + production build
npm run catalog:import   private local catalog importer
```

## Technology

React, TypeScript, Vite, React Router, React PDF/PDF.js, Supabase, IndexedDB, Vitest, and Netlify.
