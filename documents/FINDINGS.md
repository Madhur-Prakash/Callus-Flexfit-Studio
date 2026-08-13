# Things that look wrong

Everything in this file is **still in the code, behaving exactly as it did
before the restructure.** The brief's hard constraint was that the app behaves
identically when I'm done, so nothing here was silently fixed. Each entry says
what is wrong, how to reproduce it, and what the fix would be.

Confirmed items are marked ✔ where I demonstrated them with a test or a query.
Ordered by how much I'd want to fix them.

---

## 1. ✔ Class utilisation on the admin dashboard is wrong

**Where:** `src/features/back-office/server/dashboard-stats.ts`, `classUtilisation`

The `booked` count is written as a correlated subquery:

```ts
booked: sql<number>`(
  select count(*) from ${bookings}
  where ${bookings.classId} = ${classes.id}
    and ${bookings.status} in ('booked','attended')
)`.as("booked"),
```

Drizzle only qualifies column names when the outer query has a join. This query
has none, so it emits:

```sql
select count(*) from "bookings" where "class_id" = "id" and "status" in (...)
```

Inside the subquery both names resolve to `bookings`. The intended
`bookings.class_id = classes.id` becomes `bookings.class_id = bookings.id`, the
subquery stops being correlated, and **every class on the dashboard reports the
same number** — the count of bookings whose row id happens to equal their own
class id.

**Reproduce:** two members book the same class; the dashboard shows `1`.
Pinned in `tests/back-office.test.ts` ("reports the same uncorrelated count for
every class"), which asserts two different classes both report `1`.

Why it went unnoticed: the number is plausible, and `classes.list` contains the
same subquery but *does* have a `leftJoin`, so the public schedule is correct.
Only the admin view is wrong.

**Fix:** give the subquery an explicit alias so the correlation survives.

```ts
import { alias } from "drizzle-orm/sqlite-core";
const b = alias(bookings, "b");
// select count(*) from b where b.class_id = classes.id and b.status in (...)
```

Adding any join to the outer query also fixes it, but by accident — don't rely
on that. **This changes the numbers on the admin dashboard**, which is why it is
a separate decision rather than part of a "no behaviour change" refactor.

---

## 2. ✔ Corporate check-ins lose their source and their booking link

**Where:** `src/features/corporate/server/corporate-bookings.router.ts`, `markAttended`

```ts
.input(z.object({ bookingId: z.number(), source: z.enum([...]).default("front_desk") }))
// …
await ctx.db.insert(checkins).values({
  userId: booking.userId,
  bookingId: null,          // corporate ids can't go here
});                          // input.source silently dropped
```

`checkins.booking_id` is a foreign key onto the **personal** `bookings` table, so
a corporate booking id cannot be stored in it. Two consequences:

- Every corporate check-in is recorded as `front_desk`, even from the kiosk. The
  `source` argument is accepted and ignored.
- `bookings.checkinCountFor` inner-joins `checkins` to `bookings`, so corporate
  attendees never appear in the "checked in" count a trainer sees.

Pinned in `tests/corporate.test.ts`.

**Fix:** the honest one is a schema change — either a nullable
`corporate_booking_id` column alongside the existing one, or collapsing the two
booking tables into one with a nullable `company_id`. The one-line half-fix
(passing `source: input.source` through) is worth doing regardless; it is
strictly an improvement and loses nothing.

---

## 3. ✔ A stray "0" next to the notification bell

**Where:** `src/components/layout/nav-bar.tsx`

```tsx
{unreadCount && unreadCount > 0 && ( <span …>{…}</span> )}
```

When `unreadCount` is `0`, the expression short-circuits to the *number* `0`,
and React renders numbers. Any signed-in user with no unread notifications sees
`🔔0`. When it's `undefined` (still loading) the expression yields `undefined`
and renders nothing, which is why it looks fine on first paint and appears a
moment later.

I rewrote this component and had to deliberately put the bug back — the comment
in the source says so.

**Fix:** `{unreadCount ? <span…/> : null}`, or `{!!unreadCount && …}`.

---

## 4. Cancelling a class takes members' credits with it

**Where:** `src/features/classes/server/classes.router.ts`, `cancel`

When an admin cancels a class, every confirmed booking is set to `cancelled` —
and no credits are given back:

```ts
await ctx.db.update(bookings)
  .set({ status: "cancelled", cancelledAt: nowIso() })
  .where(and(eq(bookings.classId, input.id), eq(bookings.status, "booked")));
```

A member who paid two credits for a class the studio then cancelled is simply
out two credits. Compare `bookings.cancel`, which refunds when the member
cancels more than 12 hours out — the studio cancelling is treated *worse* than
the member cancelling.

Corporate bookings on the same class aren't touched at all: they stay `booked`
against a class that will never run.

**Fix:** refund unconditionally on studio-initiated cancellation (the member did
nothing wrong), and cancel the corporate bookings too, returning their credits
to the pool. Both need `documents/` sign-off first because it moves money.

---

## 5. Three of the four notification types are never sent

**Where:** `src/db/schema/notifications.ts` vs. the rest of the app

The schema declares `waitlist_promotion`, `class_cancelled`,
`membership_expiring` and `announcement`. Grepping for `insert(notifications)`
across `src/` finds exactly two sites: the seed file, and
`notifications.broadcast`. Only `announcement` is ever produced by running code.

So: a member promoted off a waitlist is never told. A member whose class was
cancelled is never told. A member whose membership expires in three days is
never told — even though `admin.expiringMemberships` exists to find them. The
seed data contains examples of all four types, which makes the feature look
finished when it isn't.

**Fix:** emit a notification at each of the three sites — waitlist promotion in
`promoteFromWaitlist`, class cancellation in `classes.cancel`, and expiry from a
scheduled job. The first two are a few lines each now that promotion is a single
function.

---

## 6. The kiosk blocks check-in for members who have already paid

**Where:** `src/app/kiosk/page.tsx`

```ts
const hasNoCredits = latestMembership?.creditsRemaining === 0;
// …
disabled={markAttended.isPending || isMembershipExpired || hasNoCredits}
```

Checking in doesn't cost credits — the credit was spent when the class was
booked. A member on a 10-credit pack who has booked all ten classes has a
balance of 0 and is refused entry at the desk for classes they have already
paid for.

Same for `isMembershipExpired`: a member whose membership lapsed yesterday but
who booked a class last week is turned away.

**Fix:** show the warnings (they're useful context for the desk) but don't
disable the button. The booking is the proof of payment.

---

## 7. Attendance frees up spots on the public schedule

**Where:** `classes.router.ts` `list` vs `dashboard-stats.ts` `classUtilisation`

The two count differently:

- `classes.list` counts `status = 'booked'` → drives `spotsLeft` and `full`
- `classUtilisation` counts `status IN ('booked','attended')`

Once the front desk marks someone attended, they drop out of the schedule's
count, `spotsLeft` goes up, and the class can be over-booked. For a class that
has already started this is mostly harmless; for a class being checked in early
it isn't.

**Fix:** count `('booked','attended')` in both. Note this interacts with #1 —
fix them together.

---

## 8. Booking is not atomic, and capacity is racy

**Where:** `bookings.router.ts` `book` / `cancel`, and the corporate equivalents

Each of these is several independent writes with no transaction:

```
insert booking → update membership credits          (book)
update booking → refund credits → promote → charge  (cancel)
```

A failure between them leaves a booked class that cost nothing, or a cancelled
booking whose credits vanished. libSQL supports transactions; Drizzle exposes
`db.transaction()`.

Separately, capacity is checked with a `count(*)` and then an `insert`, with no
lock and no unique constraint. Two concurrent requests for the last spot both
see room and both get it. For a single-site gym on SQLite this is unlikely
rather than impossible.

**Fix:** wrap each mutation in `db.transaction()`. For capacity, either
`SELECT … FOR UPDATE`-style serialisation or re-check inside the transaction.

---

## 9. Announcements go to deactivated members

**Where:** `notifications.router.ts`, `broadcast`

The original named the variable `activeMembers` and then didn't filter on
`active`:

```ts
const recipients = await ctx.db.select({ id: users.id })
  .from(users).where(eq(users.role, "member"));   // no active check
```

Deactivated accounts still receive every announcement, and the count reported
back to the admin ("sent to 12 members") includes them. I kept the behaviour and
renamed the variable to `recipients` so the name stops lying.

**Fix:** `and(eq(users.role, "member"), eq(users.active, true))`.

---

## 10. Waitlist promotion can overdraw a member

**Where:** `membership-credits.ts`, `chargeCreditsForPromotion`

```ts
creditsRemaining: Math.max(0, membership.creditsRemaining - amount)
```

A member with one credit promoted into a three-credit class is charged one
credit and gets the class. Nothing flags it. The promotion also doesn't check
that their membership is still active — an expired member can be promoted into a
class they can no longer book.

The corporate path handles the same situation differently: if the pool can't
cover the class, the promotion stands and **nothing** is charged
(`chargePoolForPromotion` returns early). So the same event costs a member
partial credits and a company nothing.

This is arguably a policy question rather than a bug, but the two paths should
agree, and right now the choice looks accidental rather than decided.

**Fix:** decide the policy — skip to the next eligible person, or promote and
let the balance go negative as a debt — and apply it to both paths.

---

## 11. Waitlist queue positions can tie

**Where:** `bookings.router.ts`, `waitlisted`

Position is computed by counting rows with a strictly earlier `bookedAt`.
`bookedAt` defaults to SQLite's `CURRENT_TIMESTAMP`, which has one-second
resolution, so two people joining the same waitlist within a second both get the
same position. The tie-break in `findNextWaitlisted` (`order by bookedAt`) is
likewise undefined between them.

Also worth noting: `bookedAt` is written by SQLite as `YYYY-MM-DD HH:MM:SS`,
while `cancelledAt` is written by the application as a JavaScript ISO string
(`YYYY-MM-DDTHH:MM:SS.sssZ`). Two formats, same table, and the two sort
differently as text.

**Fix:** order and rank by `(bookedAt, id)`. Longer term, write all timestamps
from one place in one format.

---

## 12. Trainer availability assumes the studio is on UTC

**Where:** `src/features/trainers/server/availability.ts`

Availability is stored as a weekday plus `HH:MM` strings with no timezone, and
compared against the **UTC** components of the class start time. For a studio in
IST (+5:30), a trainer who sets "06:00–12:00" is being matched against UTC
hours, so the window is effectively 11:30–17:30 local.

The seed data hides this: seeded classes are generated at UTC hours too, so
everything lines up.

I moved this logic into its own module with the assumption written down rather
than changing it — fixing it shifts which classes a trainer is available for.

**Fix:** store an IANA timezone for the studio and convert, or store
availability as UTC offsets explicitly.

---

## 13. Smaller things

- **`checkAvailability` loads every class a trainer has ever taught** to check
  one time slot, then filters in JS. Add a date range to the query.
- **Sessions accumulate.** Every login inserts a new row; nothing deletes
  expired ones and logging in elsewhere doesn't invalidate old sessions.
- **`lookupByEmailOrPhone` matches on `LIKE %term%` and returns the first row.**
  Searching `9` at the front desk returns an arbitrary member. It should be an
  exact match, or return a list.
- **`payments.refund` cancels the membership but leaves its credits and any
  bookings made with them intact.** A refunded member keeps their booked classes.
- **`.btn-sm`, `.btn-danger` and `.btn-outline` don't exist.** They're used 8, 1
  and 4 times respectively and are defined neither in `globals.css` nor by
  Tailwind, so those buttons silently render unstyled or as plain text. Defining
  them is a visual change, so it's flagged, not done.
- **`--bg-secondary` and `--fg` are never defined.** Every declaration using
  them is dropped by the browser. Centralised into `components/ui/tokens.ts`
  with a comment, so defining them later is a one-line change.
- **`auth.register` works but nothing links to it.** There is no sign-up page.
- **`reschedules.reschedule` fetched a membership row it never used.** Removed —
  a discarded read has no observable effect.
- **`reschedules.history` joins `classes` *and* runs correlated subqueries** for
  the same data. It works, but `fromClassName` comes from the join while
  `fromClassTime` comes from a subquery, which is confusing to read.

---

## What I changed vs. what I only wrote down

**Changed** (no behavioural effect, verified by the test suite):

- Removed the unused membership read in `reschedule`.
- Renamed `activeMembers` → `recipients` so the name matches what it holds.
- Reordered `useUtils()` above its use in the notifications page — it worked via
  closure timing, but read as a use-before-declaration.

**Everything else above is untouched.** Each site that needs it carries a
comment pointing here, so the next person meets the decision before they meet
the surprise.
