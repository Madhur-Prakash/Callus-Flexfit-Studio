# FlexFit Studio

Class booking and membership management for a single gym site. Members book classes, buy memberships and spend class credits. Staff run the front desk, manage trainers and pull reports. Companies buy credit pools their employees book against.

## Requirements

Node 20 or newer, and pnpm. If you don't have pnpm:

```bash
npm install -g pnpm
```

The database is SQLite and lives in a file. There's no server to install and no account to create.

## Getting set up

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

That gets you a populated studio at http://localhost:3000 with a couple of weeks of classes either side of today.

`db:push` creates `flexfit.db` and applies the schema. `db:seed` fills it with sample members, plans, classes and bookings.

## Signing in

| Role    | Email                  | Password   |
| ------- | ---------------------- | ---------- |
| Admin   | admin@flexfit.test     | admin123   |
| Trainer | arjun@flexfit.test     | trainer123 |
| Member  | rahul.k@example.com    | member123  |

Every seeded member uses `member123`. The other member emails are in `src/db/seed/index.ts`.

## Commands

| Command           | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `pnpm dev`        | Development server on port 3000                     |
| `pnpm build`      | Production build                                    |
| `pnpm test`       | Run the test suite                                  |
| `pnpm typecheck`  | `tsc --noEmit`, safe to run while `dev` is up       |
| `pnpm db:push`    | Apply the schema in `src/db/schema/`                |
| `pnpm db:seed`    | Wipe the data and reseed                            |
| `pnpm db:reset`   | Delete the database file, then push and seed again  |

`db:reset` is the one you want when the data gets into a state you don't like. It's destructive and it's meant to be.

`pnpm test` needs no setup and never touches `flexfit.db` — each test file gets
its own in-memory database, with the tables generated from `src/db/schema/` when
the run starts.

## Two things that will waste your time

Don't run `pnpm build` while `pnpm dev` is running. The build writes over the directory the dev server is using and the app starts throwing `MODULE_NOT_FOUND`. Nothing is actually broken. Stop the dev server, delete `.next`, start it again. If you want to typecheck while the server is up, use `npx tsc --noEmit` instead.

If you're changing anything in `src/db/schema/`, run `pnpm db:push` afterwards or the app and the database will disagree with each other in confusing ways.

## Layout

```
src/
  app/          routes only — every page is ~6 lines
    (public)/     /, /login, /schedule, /plans
    (member)/     /dashboard, /waitlist, /notifications
    (staff)/      /kiosk, /trainer/schedule
    (admin)/      /admin/*
  features/     one folder per part of the business, each with:
                  server/  routers, rules, queries
                  ui/      client components, including the screen each page renders
  server/       tRPC context, procedures, root router
  db/           tables (schema/), client, seed data
  lib/          framework-agnostic helpers: dates, roles, formatting
  components/   app shell and shared UI primitives
tests/          behaviour tests for the whole tRPC surface
documents/      why the code is arranged this way, and what was fixed
```

The bracketed folders are Next.js route groups: they organise the tree by who
the screen is for and **do not appear in the URL** — `(admin)/admin/reports` is
still `/admin/reports`.

Two good starting points:

- `src/server/root-router.ts` names every feature and points at where it lives.
- Any `src/app/**/page.tsx` — each one names the screen it renders, so the route
  tells you which feature to open.

## Notes

- [`documents/CHANGELOG.md`](documents/CHANGELOG.md) — **start here.** Everything
  that changed and why, in three phases. Includes the list of behaviour changes
  to review before comparing against the original.
- [`documents/FINDINGS.md`](documents/FINDINGS.md) — the issue register: 24 bugs
  found, each with a repro, the fix, and its severity, plus the ones left open
  and why.
- [`documents/ARCHITECTURE.md`](documents/ARCHITECTURE.md) — the structure, the
  reasoning behind it, the alternatives rejected, and how the restructure was
  proven not to change behaviour.

> One schema change was made (`checkins.corporate_booking_id`). If you already
> have a `flexfit.db`, run `pnpm db:push`.
