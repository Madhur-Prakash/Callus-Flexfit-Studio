# Changelog

Everything changed in FlexFit Studio, and why. Companion to
[FINDINGS.md](FINDINGS.md), which is the issue register, and
[ARCHITECTURE.md](ARCHITECTURE.md), which explains the folder layout.

The work ran in three phases, deliberately in this order:

| Phase | What | Behaviour |
|---|---|---|
| [1](#phase-1) | Pin existing behaviour with tests | Unchanged |
| [2](#phase-2) | Restructure the codebase | Unchanged, and proven so |
| [3](#phase-3) | Fix the bugs the work surfaced | **Changed — see below** |

Phases 1 and 2 changed nothing a user could observe. Everything in phase 3 was a
deliberate decision, and every user-visible change is listed.

---

<a id="phase-1"></a>
## Phase 1 — A safety net

Nobody hands you a list of what the app does, so the first job was writing one
down in a form that fails loudly.

**Added** a characterization test suite: 125 tests over the whole tRPC surface,
pinning credit arithmetic, waitlist ordering, the 12/24/4-hour windows,
corporate credit pools, billing, reports and every role guard. Error *codes and
messages* are asserted verbatim — a member who saw "Not enough class credits
remaining." must still see exactly that.

**Design decision:** only `tests/support/app.ts` knows where the source lives.
Everything else imports through it. That is what made the next phase provable.

**Infrastructure:**
- `vitest.config.ts` with the `@/` alias.
- `tests/support/global-setup.ts` derives the test schema from
  `src/db/schema/` via drizzle-kit on every run, so the tables under test cannot
  drift from the tables the app uses.
- `tests/support/harness.ts` — per-test database, fixtures, and an
  `expectTrpcError` helper that pins code *and* message.

The suite was green against the untouched original before a single file moved.

---

<a id="phase-2"></a>
## Phase 2 — Restructure

Full reasoning in [ARCHITECTURE.md](ARCHITECTURE.md). Summary of what moved:

### Layout

Feature-first. Each slice under `src/features/<name>/` owns its `server/`
(routers, rules, queries) and its `ui/`. `src/app` holds routes only;
`src/server` the tRPC wiring; `src/db` the tables; `src/components/ui` shared
presentation.

The `server/` / `ui/` split is not decoration: `src/db/client.ts` pulls in
Drizzle and libSQL, and a client component importing it — even transitively,
even for a constant — drags the database driver into the browser bundle.

### Duplication removed

- `hoursUntil` existed in three copies, the active-membership lookup in two, the
  today/14-day date maths in four → `lib/datetime.ts` and
  `features/memberships/server/membership-credits.ts`.
- `999` was written literally in four places → `features/memberships/credits.ts`
  (dependency-free, so the browser can use it too).
- **`reschedules.reschedule` and `reschedules.validateReschedule` each carried
  their own copy of the same ten validation rules** — about 120 lines, already
  drifting apart. Both now call `evaluateReschedule`, so the greyed-out button
  and the error you would have got cannot disagree. Ten table-driven tests
  assert that equivalence rule by rule.
- ~13 copies of the panel / stat-tile / alert / badge markup → `components/ui`.
- Credit arithmetic became three *named* operations (`chargeCredits`,
  `refundCredits`, and the promotion path) rather than three subtly different
  inline updates. A single `adjustCredits(±n)` would have hidden exactly the
  distinction that makes it correct.

### Files split by responsibility

| File | Before | After |
|---|---|---|
| `admin.ts` | 268 lines, three unrelated report types | three modules behind the same flat namespace |
| `members.ts` | self-service + staff directory | two modules, one namespace |
| `db/schema.ts` | 240 lines | six domain files + barrel |
| `admin/companies/[id]` | 255 lines | 148 + `TopUpForm`, `MemberPicker` |
| `trainer/schedule` | 230 lines | 61 + `AvailabilityEditor`, `TrainerClassCard` |
| `dashboard` | 189 lines | 87 + `MembershipSummary`, `BookingRow`, `RescheduleHistory` |

### Deliberately *not* merged

Personal and corporate bookings look like the same code twice. They spend
different money under different rules — 12-hour vs 24-hour windows, and
different answers when a payer runs short. A generic version would need the
table, balance column, window and promotion policy passed in, and would hide
which pool is being spent. `company-credits.ts` says so in a comment.

### How phase 2 was proven safe

1. The 125 tests passed unchanged.
2. **No test body was edited.** After moving all 40 files the diff on `tests/`
   was two lines, both in support files. A behaviour change would have forced a
   test change.
3. **Generated DDL was byte-identical** to the previous schema, statement for
   statement.
4. An end-to-end pass over the real seeded database — login, book, cancel,
   refund, all eight admin reports, role guards — gave the same answers.
5. The production build succeeded with per-route bundles unchanged (~126–130 kB),
   so nothing server-side leaked into the browser.

Not covered: visual rendering. Class strings and inline styles were reproduced
by hand and checked, but no screenshot diff was taken.

---

<a id="phase-3"></a>
## Phase 3 — Bug fixes

Full detail per issue in [FINDINGS.md](FINDINGS.md). This is what changed.

### Behaviour changes a user will notice

These are the ones to review before comparing against the original.

- **Classes fill at their real capacity.** Personal and corporate bookings now
  share one count. A class of capacity 10 previously accepted 10 of each.
  ([#1](FINDINGS.md#1))
- **You cannot take two spots on one class** by booking personally and through
  your employer. ([#2](FINDINGS.md#2))
- **Cancelling a class refunds everyone**, regardless of how close to the start
  time, including corporate bookings back to the employer's pool. Waitlisted
  members are cancelled too. ([#3](FINDINGS.md#3))
- **Upgrading a waitlist place to a confirmed spot now costs credits.** It was
  free. ([#4](FINDINGS.md#4))
- **Members are no longer charged twice** when a rescheduled booking is promoted.
  ([#5](FINDINGS.md#5))
- **Deactivating an account takes effect immediately** instead of whenever the
  session expired. ([#6](FINDINGS.md#6))
- **Rescheduling away promotes whoever was waiting** for the spot you left.
  ([#7](FINDINGS.md#7))
- **Admin class-utilisation figures change**, to correct ones. They were
  previously identical for every class. ([#8](FINDINGS.md#8))
- **Waitlist promotion skips anyone who cannot pay** rather than partially
  charging a member or giving a company a free class. ([#9](FINDINGS.md#9))
- **Trainer check-in counts go up** where corporate members attended; they were
  undercounted. ([#10](FINDINGS.md#10))
- **`spotsLeft` accounts for corporate bookings** and stays accurate once people
  are checked in. ([#13](FINDINGS.md#13), [#14](FINDINGS.md#14))
- **Members are told** when they come off a waitlist or their class is cancelled.
  ([#15](FINDINGS.md#15))
- **The kiosk no longer refuses members who have already paid.**
  ([#16](FINDINGS.md#16))
- **Announcement recipient counts drop** where deactivated members exist.
  ([#17](FINDINGS.md#17))
- **`.btn-sm`, `.btn-danger`, `.btn-outline` now render as buttons** — they were
  undefined, so those controls were unstyled. ([#22](FINDINGS.md#22))

### Invisible but important

- Every mutation that moves credits runs in a transaction, with the reads that
  decide the outcome inside it. Closes a lost-update window on balances.
  ([#11](FINDINGS.md#11))
- The schedule page no longer refetches `classes.list` in a loop — it was firing
  a request roughly every 30ms for as long as the tab was open.
  ([#12](FINDINGS.md#12))
- Waitlist positions rank on `(bookedAt, id)`, so they cannot tie.
  ([#18](FINDINGS.md#18))
- Expired sessions are cleared on login. ([#23](FINDINGS.md#23))
- `checkAvailability` queries one day instead of a trainer's whole history.
  ([#24](FINDINGS.md#24))
- Two pickers stopped offering options the server would reject.
  ([#19](FINDINGS.md#19), [#20](FINDINGS.md#20))
- The stray `🔔0` is gone. ([#21](FINDINGS.md#21))

### Schema change

One, additive:

```
checkins.corporate_booking_id  integer NULL  → corporate_bookings(id)
```

`checkins.booking_id` is a foreign key onto the *personal* bookings table, so
corporate check-ins could not be recorded against anything. Applied with
`pnpm db:push`; the 96 seeded check-ins kept their data.

**If you are pulling these changes into an existing database, run
`pnpm db:push`.**

### New modules

| Module | Why |
|---|---|
| `features/classes/server/class-capacity.ts` | one answer to "is there room" and "is this person already on it", across both booking tables |
| `features/bookings/server/waitlist.ts` | promotion in one place, used by cancel *and* reschedule |
| `features/notifications/server/notify.ts` | raising the notification types nothing ever raised |
| `lib/hooks/use-now-iso.ts` | a stable "now" for query inputs |
| `lib/hooks/use-transient.ts` | the "show a confirmation for 3s" pattern, previously copy-pasted |

### Tests

125 → **141**. The tests that had pinned each bug were rewritten to assert the
intended behaviour, so the suite now describes what the app *should* do rather
than what it happened to do. New file `tests/booking-integrity.test.ts` covers
the cross-cutting invariants — shared capacity, one-person-one-spot, and credits
being charged exactly once across the reschedule and promotion paths.

Each of those six started as a failing test proving the bug existed.

### Test harness changes forced by the fixes

`db.transaction()` does not work against a `:memory:` libSQL database — the
tables are gone once the transaction commits. Each test now gets its own
temporary database *file*, which also matches how the app really runs. Two
latent harness bugs surfaced doing this: DDL execution was never awaited, and
filenames derived from the process id collided across parallel worker threads.

---

## Housekeeping

- `package.json`: `pnpm typecheck` added; `db:seed` repointed at the moved seed.
- `drizzle.config.ts`: schema path updated; honours `DB_FILE` like the app does.
- Filenames are kebab-case throughout. The original mixed `NavBar.tsx` with
  `reschedule-modal.tsx`; on Windows and macOS the filesystem hides case
  collisions that then break a Linux CI box.
- `README.md`: commands table, layout map, and pointers to these documents.

---

## Verification

Current state, all green:

```
pnpm typecheck     # tsc --noEmit, clean
pnpm test          # 141 passing
pnpm build         # succeeds, 17 routes
```

Plus an end-to-end pass against the real seeded database covering login,
booking, credit arithmetic, reschedule validation parity, cancellation refunds,
notifications, all eight admin reports and every role guard.

**Known gap:** no automated visual regression. UI changes were verified by
reading the markup and by loading every route, not by screenshot comparison.
