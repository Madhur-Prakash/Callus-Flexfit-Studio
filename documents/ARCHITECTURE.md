# How this codebase is laid out, and why

FlexFit Studio arrived as ~5,400 lines across 40 files, written by five people
who never spoke to each other. It worked. The problem was that nothing told you
where anything lived, and the same decision had been made in four places with
four slightly different answers.

This document explains the structure I moved it to and the reasoning behind
each choice. Where I picked one option over another, the alternative is stated
too — the folder layout is a judgement call, not a fact.

---

## The shape

```
src/
├── app/          Next.js routes. Nothing else.
├── features/     One folder per part of the business.
├── server/       tRPC wiring: context, procedures, the root router.
├── db/           Tables and seed data.
├── lib/          Framework-agnostic helpers.
├── components/   Layout and shared presentation.
└── env.ts        Validated environment access.
```

A feature slice looks like this:

```
src/features/bookings/
├── server/
│   ├── bookings.router.ts       the tRPC surface
│   ├── booking-policy.ts        rules: windows, refundability, guards
│   ├── booking-repository.ts    the queries
│   └── waitlist.ts              promotion, shared by cancel and reschedule
└── ui/
    ├── dashboard-screen.tsx     what /dashboard renders
    └── booking-row.tsx          the pieces it is built from
```

### The route layer

`src/app` holds routes and nothing else. Every page is a Server Component about
six lines long:

```tsx
export const metadata: Metadata = { title: "My bookings" };

export default function Page() {
  return <DashboardScreen />;
}
```

Two things fall out of that. Pages can declare `metadata`, which a
`"use client"` page cannot — so every route now has a real title instead of all
seventeen sharing one. And the client boundary is visible in the import: the
route is server, the screen it names is client.

Routes are grouped by audience — `(public)`, `(member)`, `(staff)`, `(admin)`.
Route groups do not appear in the URL, so `(admin)/admin/reports` is still
`/admin/reports`; they exist so the tree answers "who is this for" at a glance,
which is the same question the feature folders answer on the other side.

`error.tsx` and `not-found.tsx` sit at the root: a screen that throws shows a
recoverable message rather than blanking the app.

## Why feature-first

The original grouped by technical kind: every router in `src/server/routers/`,
every component in `src/components/`. That reads nicely in a file tree and
badly in practice, because no unit of work is ever "change all the routers".
Work arrives as *"waitlist promotion is charging the wrong member"*, and the
answer to that lived in `routers/bookings.ts`, `routers/corporate-bookings.ts`
and a `999` written out by hand in two page files.

Grouping by feature puts the things that change together next to each other. To
understand booking you open one folder and see the rules, the queries, the API
and the UI. The blast radius of a change is visible from the path.

The cost is real and worth naming: some concepts touch several slices, and you
have to decide which slice owns them. `memberships` owns credits even though
`bookings` spends them, because credits belong to the membership. Where a slice
needs another's rules it imports them explicitly (reschedules imports the
booking-status predicates), which keeps the dependency visible rather than
duplicating it.

**Alternative considered:** layered (`domain/`, `application/`, `infrastructure/`).
Rejected as too much ceremony for 6,000 lines — it would have added three
directory levels without removing a single duplicated rule.

## Why `server/` and `ui/` inside each feature

Not decoration. `src/db/client.ts` pulls in Drizzle and libSQL, and a client
component that imports it — even transitively, even only for a constant — drags
the database driver into the browser bundle.

I hit this while writing the plans page: it needed `UNLIMITED_CREDITS`, which
lived beside the credit-mutation functions in a module that imports the
database. The fix was `features/memberships/credits.ts`, a dependency-free
module holding the constant and its predicate, which the server module
re-exports. The `server/` / `ui/` split makes that class of mistake visible in
the import path instead of in a bundle analyzer.

## Screens, and why they are not pages

The heavy screens were split before they moved:

| Screen | Before | After |
|---|---|---|
| company detail | 255 lines | 148, plus `TopUpForm` and `MemberPicker` |
| trainer schedule | 230 lines | 61, plus `AvailabilityEditor` and `TrainerClassCard` |
| dashboard | 189 lines | 87, plus `MembershipSummary`, `BookingRow`, `RescheduleHistory` |

The extracted pieces live in their feature's `ui/`, not a global components
folder, because `AvailabilityEditor` is only ever a trainers thing.

Each of those screens then moved out of `src/app` entirely, leaving a six-line
route behind. That is what makes "app holds routes only" true rather than
aspirational: `/dashboard` is a route that names `DashboardScreen`, and the
screen lives with the bookings code it is made of.

## The duplication that mattered

Four copies of `hoursUntil`. Two of the active-membership lookup. `999` written
literally in four places. Thirteen copies of the same stat-tile markup. Those
are tedious but harmless.

The one that mattered was `reschedules.ts`. It had a `reschedule` mutation and a
`validateReschedule` query, and each carried its own copy of the same ten rules
— roughly 120 duplicated lines. They had already begun to drift. Both now call
`evaluateReschedule`, which returns either a rejection carrying a tRPC code and
a message, or an approval carrying the rows the mutation needs:

```ts
const evaluation = await evaluateReschedule(db, userId, input);

// the mutation:  if (!evaluation.ok) throw new TRPCError({ code, message })
// the dry run:   evaluation.ok ? { valid: true, … } : { valid: false, reason }
```

The greyed-out button and the error you would have got can no longer disagree,
because they are the same function. Ten table-driven tests in
`tests/reschedules.test.ts` assert that equivalence rule by rule.

Credit arithmetic got the same treatment — not deduplicated into one function,
but named. There were three subtly different variants and the differences were
load-bearing, so they became three functions that say what they are:

- `chargeCredits` — taking payment for a spot, skipped on unlimited plans
- `refundCredits` — giving credits back, skipped on unlimited plans
- `chargeCreditsForPromotion` — charging someone pulled off a waitlist; floors
  at zero rather than refusing, because the spot has already been given away

A single `adjustCredits(±n)` would have been shorter and would have hidden
exactly the distinction that makes the code correct.

## Keeping the surface small

Modules export the operation callers need, not the pieces it is built from.
`class-capacity` exports `isClassFull` and `findExistingParticipation`, and
keeps `countConfirmedSpots` private; `company-credits` exports
`promoteFromCorporateWaitlist` and keeps the queue query and the
can-this-company-pay check private.

This is enforced by an audit rather than by discipline: a script walks every
exported symbol and reports the ones nothing outside their own file references.
It found 21 after the bug-fix phase — three of them helpers that the capacity
fix had superseded but not deleted, which is the dangerous kind, because the
wrong answer stays one import away.

The audit needed a second pass to be trustworthy. Counting any reference as a
use meant a barrel kept dead code alive: `components/ui/index.ts` re-exported a
`Panel` component that no screen rendered, and that mention was enough to make
it look used. Re-running the check while ignoring the barrel found it. The
lesson generalises — a re-export is a reference, not a user.

It now reports zero dead exports.

## What I deliberately did not merge

Personal and corporate bookings look like the same code twice: both count
confirmed bookings, find the next waitlisted member, promote them, and charge
for it. It is tempting to write one generic implementation over both tables.

I left them separate. They spend different money — one a member's credits, one
an employer's shared pool — under different rules (12-hour window vs 24-hour;
an overdrawn member is floored at zero, an overdrawn company is not charged at
all). A generic version would need the table, the balance column, the window and
the promotion policy passed in, at which point the abstraction is longer than
both concrete versions and hides which pool is being spent. The duplication is
about forty lines and it is honest. `company-credits.ts` carries a comment
saying so, so the next person knows it was a decision.

## Splitting files that did two jobs

- **`admin.ts`** (268 lines) answered three unrelated questions: what does the
  studio look like right now, how much money came in, and who turned up. Now
  `dashboard-stats.ts`, `revenue-reports.ts`, `attendance-reports.ts`, merged
  into one router at the end. The flat `admin.*` namespace is part of the client
  contract, so it is preserved exactly — the split is internal.
- **`members.ts`** mixed a member managing their own profile with staff
  searching the directory. Different audiences, different permissions, now
  different files behind the same namespace.
- **`schema.ts`** (240 lines) is six files by domain, re-exported through a
  barrel. Generated DDL is byte-identical (see below); the database is untouched.

## Naming

Files are kebab-case throughout. The original had `NavBar.tsx` next to
`reschedule-modal.tsx`; on Windows and macOS the filesystem hides case
collisions that then break a Linux CI box. Routers keep a `.router.ts` suffix so
the API surface is greppable.

---

## How I know the behaviour did not change

The work came in two deliberate phases:

1. **Restructure, behaviour frozen.** Everything moved; nothing changed.
2. **Fix the bugs the restructure surfaced**, as a separate step with the tests
   updated to state the new intent.

This section is about phase one — proving the move was safe. Phase two is
[documents/FINDINGS.md](FINDINGS.md), which lists every behaviour that changed
afterwards and why.

Nobody hands you a list of what the app does. Working that out was most of the
job.

**1. Characterization tests, written first.** 125 tests against the tRPC surface
pinning credit arithmetic, waitlist ordering, the 12/24/4-hour windows,
corporate pools, billing, reports and every role guard. Error *codes and
messages* are asserted verbatim, because a member who used to see "Not enough
class credits remaining." must still see exactly that.

They run against a fresh in-memory SQLite database per test file, with the
schema generated from `src/db/schema/` by drizzle-kit at startup — so the tables
under test can never drift from the tables the app uses.

The suite was green on the original code before a single file moved.

**2. The tests could not be quietly adjusted to fit.** Only `tests/support/app.ts`
knows where the source lives. After moving all 40 files, the diff on `tests/` is
two lines, both in support files, and no test body changed:

```
 tests/support/app.ts          | 2 +-
 tests/support/global-setup.ts | 2 +-
```

If a refactor had changed behaviour, a test body would have had to change.

**3. The database is provably untouched.** DDL generated from the old
`schema.ts` and from the new `schema/` folder is identical statement for
statement (only emission order differs). No migration, no `db:push` needed.

**4. An end-to-end pass over the real seeded data.** Against a production build
and the actual `flexfit.db`: all 14 routes return 200; a member logs in, books a
class, has exactly the right credits debited, is refused a duplicate, gets the
same message from `validateReschedule` and `reschedule`, cancels and is refunded;
an admin reads all eight reports, refunds a payment, is refused the second
refund; a trainer sees their own classes and is refused admin stats.

**5. Nothing leaked into the browser.** The production build succeeds and
per-route bundles stay at ~126–130 kB.

What none of this covers: visual rendering. I reproduced every class string and
inline style by hand and checked them against the originals, but no screenshot
diff was taken. If you want certainty on pixels, that is the gap.

### And then the fixes

Once the move was proven safe, the bugs it had surfaced were fixed. The tests
that had pinned each bug were rewritten to assert the intended behaviour, so the
suite now says what the app *should* do rather than what it happened to do —
133 tests, all passing.

Two of those fixes are worth flagging here because they are not local:

- **The schema changed.** `checkins` gained a nullable
  `corporate_booking_id`, so corporate attendance can be recorded at all. It is
  additive, `pnpm db:push` has been run, and the 96 seeded check-ins survived.
- **Mutations are transactional now.** Anything that moves credits runs inside
  `db.transaction()`. This forced a change in the test harness: `db.transaction()`
  does not work against a `:memory:` libSQL database — the tables disappear when
  the transaction commits — so each test now gets its own temporary database
  *file*. That is closer to how the app runs anyway.

Every behaviour that changed, and every one deliberately left alone, is listed
in [FINDINGS.md](FINDINGS.md).

---

## Running it

```
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

`pnpm test` runs the suite. `pnpm typecheck` is `tsc --noEmit`, which is what to
use while `pnpm dev` is running — a `pnpm build` at the same time overwrites the
directory the dev server is reading and produces confusing MODULE_NOT_FOUND
errors. Stop dev, delete `.next`, start again if that happens.

## Where to read next

- [FINDINGS.md](FINDINGS.md) — the 24 bugs found, each with a repro and a fix,
  plus the ones left open and why.
- [CHANGELOG.md](CHANGELOG.md) — everything that changed, in the order it
  happened, including the behaviour changes to review before comparing against
  the original.
