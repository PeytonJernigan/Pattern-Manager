# Pattern Manager security and operations

Pattern Manager is a private two-person application. Netlify serves public
HTML, CSS, and JavaScript, while Supabase Auth, Row Level Security, and private
Storage protect every catalog record and file. Never place catalog exports,
PDFs, thumbnails, emails, or secrets in the Netlify publish directory.

## Production setup

1. Create separate Supabase projects for production and local/preview use.
2. Apply `supabase/migrations/202608150001_initial_pattern_manager.sql`.
3. Deploy Netlify with the production Supabase URL and publishable key, then set
   the production Site URL and redirect allowlist to its exact HTTPS URLs.
   Do not wildcard Netlify preview URLs into the production project.
4. Invite exactly two users from the Supabase Auth Dashboard. Do not add an
   invitation endpoint to the web application.
5. Fill in and execute `supabase/seed.example.sql` as one transaction. The file
   accepts Auth UUIDs only; do not put email addresses in source control.
6. Disable new-user sign-up, anonymous sign-in, unused identity providers, and
   manual identity linking.
7. Run every query in `supabase/validation/001_initial_schema_checks.sql`.
8. Have both members accept their invitations and use email-link sign-in.
9. Review Supabase Security Advisor findings before launch. Do not require MFA
   until enrollment, challenge, recovery, and AAL2 authorization are implemented.

The database enforces exactly two active members and exactly one owner at the
end of every transaction. Replacing a member must therefore deactivate the old
membership and insert the replacement in one transaction. An Auth account with
no active membership receives no household ID and cannot pass application RLS.

## Keys and environment variables

The browser may receive only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The publishable key is not an authorization boundary. RLS is the authorization
boundary. A Supabase secret/service key bypasses RLS and must never appear in:

- a `VITE_` variable;
- Git history;
- browser code or source maps;
- a URL, query parameter, log, screenshot, or support bundle.

If a privileged Netlify Function is added, keep `SUPABASE_SECRET_KEY` in a
Functions-only Netlify secret. The function must validate the caller's current
Supabase session and owner membership before creating a secret-key client.

## Storage rules

Both Storage buckets are private.

- Pattern files: `pattern-assets/<household>/catalog/...`
- Pattern thumbnails: `pattern-assets/<household>/thumbnails/...`
- Project files: `project-media/<household>/projects/<project>/...`

The project UUID segment is mandatory for every `project-media` asset. Database
RLS parses that segment before revealing even the asset's filename, size, hash,
or metadata, so the other household member cannot discover metadata belonging
to a private project. The Storage object policy enforces the same visibility.

Store relative paths in Postgres, never signed URLs. Upload private objects with
zero cache lifetime. Thumbnails use expiring signed URLs that are renewed while
the app is open; PDF downloads use a 60-second signed URL with `no-store` and
pass the resulting bytes directly to PDF.js. Do not persist signed URLs.

Storage is append-only for authenticated users in v1. They may insert a new
object and read an object allowed by RLS, but no browser UPDATE or DELETE policy
exists for either bucket. Replacements use a new content-addressed path and a
new asset row. Browser deletion is deliberately omitted until a checked server
operation can remove an object and all database references together.

The corresponding asset identity is also immutable: ID, household, bucket,
path, SHA-256, byte size, MIME type, original filename, creator, creation time,
and deletion state cannot be changed by an authenticated client. Extracted or
descriptive metadata such as page count, language, version, role, and `metadata`
may still be corrected. The original PDF remains untouched; page marks live in
`pdf_annotations`, and exports create a separate annotated asset version.

Use `set_pattern_primary_asset` when replacing a pattern's main instructions.
Do not separately update `pattern_assets` and `patterns.primary_asset_id` from
the browser; the RPC verifies household ownership and changes both atomically.
Database triggers reject authenticated attempts to create, replace, edit, or
remove a primary link outside that RPC. Ordinary non-primary links and other
pattern fields remain directly editable.

The local service-role importer is trusted administrative code and bypasses
end-user RLS and write guards. Run the validation SQL after every applied import
and never expose the importer or its key through Netlify or the browser.

## Offline data

The service worker caches only versioned application assets. Mutation outboxes
are namespaced by Auth user ID. Before sign-out, the app requires confirmation
before discarding unsynced changes, then clears that user's outbox. PDF bytes
and thumbnails are not persisted in IndexedDB by this release.

`increment_project_counter` uses an immutable client mutation UUID, a transaction
lock, and a ledger row so an offline retry changes the counter at most once.
Authenticated clients cannot directly change `current_value` or `revision`;
counter names, steps, targets, and other ordinary metadata remain editable.
PDF annotations use an integer revision and reject stale updates.

## Backups and incident response

Supabase database backups do not include Storage objects. Maintain both:

- a scheduled logical database export; and
- a separate encrypted copy of both private Storage buckets.

Periodically test a restore into the non-production project. A backup that has
not been restored successfully is not considered verified.

If an account or device is compromised:

1. revoke the user's sessions in Supabase Auth;
2. replace/deactivate membership in a single database transaction;
3. rotate any exposed secret key immediately;
4. clear offline data on accessible devices;
5. review Auth logs, `activity_log`, Storage objects, and recent imports;
6. restore affected data from a verified backup if necessary.

`activity_log` is a household collaboration feed, not an immutable forensic
audit log. Use Supabase and Netlify platform audit logs for administrative events.
