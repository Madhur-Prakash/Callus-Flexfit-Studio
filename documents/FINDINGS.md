# Issue register

Every defect found while reviewing FlexFit Studio, in the style of an issue
tracker: what is wrong, how to reproduce it, what it costs, and what was done.

Bugs were found in two passes. The first came out of working out what the app
did in order to restructure it safely; the second was a deliberate read of the
whole codebase looking for broken logic. All of them were written up before
anything was changed.

For the record of *changes* — including the restructuring work that was not
bug-driven — see [CHANGELOG.md](CHANGELOG.md).

---

## Summary

| # | Issue | Severity | Status |
|---|---|---|---|
| [1](#1) | Capacity not enforced across both booking tables | **Critical** | Fixed |
| [2](#2) | One member can take two spots on the same class | **Critical** | Fixed |
| [3](#3) | Cancelling a class kept members' credits | **Critical** | Fixed |
| [4](#4) | Waitlist place could be upgraded to a paid spot for free | **High** | Fixed |
| [5](#5) | Members charged twice for one class | **High** | Fixed |
| [6](#6) | Deactivated members kept access for up to 30 days | **High** | Fixed |
| [7](#7) | Rescheduling away left the freed spot empty | **High** | Fixed |
| [8](#8) | Class utilisation report was uncorrelated | **High** | Fixed |
| [9](#9) | Waitlist promotion overdrew members, gave companies free classes | **High** | Fixed |
| [10](#10) | Corporate check-ins lost their source and booking link | **High** | Fixed |
| [11](#11) | Money moved without transactions; credit balances could be lost | **High** | Fixed |
| [12](#12) | Schedule page refetched for ever | **High** | Fixed |
| [13](#13) | Corporate bookings invisible in `spotsLeft` | Medium | Fixed |
| [14](#14) | Checked-in attendees freed up their spot | Medium | Fixed |
| [15](#15) | Three of four notification types never sent | Medium | 2 of 3 fixed |
| [16](#16) | Kiosk turned away members who had already paid | Medium | Fixed |
| [17](#17) | Announcements went to deactivated accounts | Medium | Fixed |
| [18](#18) | Waitlist positions could tie | Low | Fixed |
| [19](#19) | Reschedule picker offered the class you were already on | Low | Fixed |
| [20](#20) | Company member picker offered staff | Low | Fixed |
| [21](#21) | Stray `0` beside the notification bell | Low | Fixed |
| [22](#22) | Three CSS classes and two variables never defined | Low | Fixed |
| [23](#23) | Sessions accumulated for ever | Low | Fixed |
| [24](#24) | Availability check loaded every class ever taught | Low | Fixed |
| [25](#25) | Known issues left open | — | Open |

---

<a id="1"></a>
## 1. Capacity not enforced across both booking tables — **Critical**

**Where:** `bookings.book`, `corporateBookings.book`

Members book through `bookings`; corporate employees book through
`corporate_bookings`. Each path counted only its own table when deciding
whether a class was full:

```ts
// bookings.book
const isFull = (await countConfirmedBookings(tx, cls.id)) >= cls.capacity;
// corporateBookings.book
const isFull = (await countConfirmedCorporateBookings(tx, cls.id)) >= cls.capacity;
```

They are separate tables but the same room. A class of capacity 10 could take
10 personal bookings **and** 10 corporate ones — twenty people in a studio built
for ten.

**Reproduce:** a class of capacity 1; book it personally, then book it again as
a corporate member. Both come back `booked`.

**Fix:** one `countConfirmedSpots` in `classes/server/class-capacity.ts`, summing
both tables, used by both booking paths and by the reschedule check.

**Impact:** classes fill at their real capacity. Existing over-subscribed
classes stay as they are — nothing is retroactively cancelled.

---

<a id="2"></a>
## 2. One member can take two spots on the same class — **Critical**

**Where:** same two procedures

The duplicate check was also per-table, so someone linked to a corporate
account could book a class personally *and* through their employer. Two spots
for one person, paid for twice — once in their own credits, once from the
employer's pool.

**Reproduce:** as a corporate member with a personal membership, call
`corporateBookings.book` then `bookings.book` on the same class. Both succeed.

**Fix:** `findExistingParticipation` checks both tables. The second attempt now
fails with the existing message, "You are already on the list for this class."

---

<a id="3"></a>
## 3. Cancelling a class kept members' credits — **Critical**

**Where:** `classes.cancel`

Cancelling a class marked every confirmed booking `cancelled` and refunded
nothing. A member who paid two credits for a class *the studio* called off was
simply out two credits — worse treatment than cancelling themselves, which
refunds outside the 12-hour window. Waitlisted members were left queuing for a
class that would never run, and corporate bookings were not touched at all:
still `booked` against a dead class, employer's credits still spent.

**Fix:** refunds unconditionally (the member did nothing wrong, so the 12-hour
rule does not apply), cancels waitlisted rows, cancels corporate bookings and
returns their credits to the pool — all in one transaction.

**Impact:** money moves that previously did not.

---

<a id="4"></a>
## 4. Waitlist place could be upgraded to a paid spot for free — **High**

**Where:** `reschedules.reschedule`

The move carried `creditsUsed` across unchanged:

```ts
creditsUsed: booking.creditsUsed,   // 0 for a waitlist place
```

Joining a full class costs nothing, so a waitlisted booking has
`creditsUsed = 0`. Rescheduling it into a class *with room* produced a
**confirmed** booking still marked as having paid nothing. Free classes, on
repeat: join any full class, immediately reschedule into an open one.

**Reproduce:** waitlist yourself on a full class, then reschedule to an open
class of the same name. Status comes back `booked`, balance unchanged.

**Fix:** `evaluateReschedule` computes `outstandingCredits` —
`max(0, target.creditCost − alreadyPaid)` — and refuses the move with "Not
enough class credits remaining." if the member cannot cover it. The mutation
charges it.

---

<a id="5"></a>
## 5. Members charged twice for one class — **High**

**Where:** `promoteFromWaitlist`, and its corporate twin

Promotion always charged the full class price:

```ts
.set({ status: "booked", creditsUsed: cls.creditCost })
await chargeCredits(db, membership, cls.creditCost);
```

Usually right, because a waitlist place has paid nothing. But a booking that
arrived on the waitlist *by rescheduling* carries the credits it already paid.
Promoting it charged full price a second time.

**Reproduce:** book class A (2 credits), reschedule to full class B, get
promoted when someone drops out. Balance falls by 4 for one class.

**Fix:** both promotion paths charge only `max(0, creditCost − creditsUsed)`.

---

<a id="6"></a>
## 6. Deactivated members kept access for up to 30 days — **High**

**Where:** `server/trpc/context.ts`

`auth.login` refuses inactive accounts, but that only guards the front door.
`createContext` resolved a session without ever checking `users.active`, so
someone already signed in kept full access until their 30-day session expired.
Deactivating an account did nothing to anyone currently using it.

**Fix:** the context treats an inactive account as no session, and
`members.setActive(false)` deletes that user's sessions so the cookie is dead
rather than merely ignored.

---

<a id="7"></a>
## 7. Rescheduling away left the freed spot empty — **High**

**Where:** `reschedules.reschedule`

`bookings.cancel` promotes the longest waiter when a confirmed spot is freed.
Rescheduling frees a spot in exactly the same way and promoted nobody, so the
place sat empty while members queued for it.

**Fix:** the mutation now promotes from the original class's waitlist and
notifies whoever moved up, same as cancelling.

---

<a id="8"></a>
## 8. Class utilisation report was uncorrelated — **High**

**Where:** `admin.classUtilisation`

Drizzle only qualifies column names when the outer query has a join. This query
had none, so a correlated subquery compiled to:

```sql
select count(*) from "bookings" where "class_id" = "id" …
```

Both names resolve to `bookings`, so `bookings.class_id = classes.id` became
`bookings.class_id = bookings.id` — uncorrelated, with **every class reporting
the same number**. It went unnoticed because the figure looked plausible, and
because `classes.list` has the same subquery but *does* have a `leftJoin`, so
only the admin view was wrong.

**Fix:** rewritten as a `leftJoin` + `GROUP BY`, removing the trap rather than
working around it. On the seeded data the dashboard now reads
`0/14  4/20  8/18  17/20 …` instead of one repeated figure, and each number
cross-checks against that class's roster.

`classes.list` still uses the subquery form; a comment now records that its join
is load-bearing.

---

<a id="9"></a>
## 9. Waitlist promotion overdrew members and gave companies free classes — **High**

**Where:** `membership-credits.ts`, `company-credits.ts`

Personal promotion charged `Math.max(0, balance − cost)`: a member with one
credit promoted into a three-credit class was charged one credit and given the
class. The corporate path did the opposite — if the pool could not cover it, the
promotion went ahead and **nothing** was charged, so the employer got a free
class. Two paths, two different accidental answers.

**Fix:** one rule for both — promote the longest waiter *who can pay*, pass over
anyone who cannot, leave the spot open if nobody can. Someone without the
credits could not book the class through the front door either.

---

<a id="10"></a>
## 10. Corporate check-ins lost their source and booking link — **High**

**Where:** `corporateBookings.markAttended`

```ts
bookingId: null,   // corporate ids cannot go here
                   // input.source silently dropped
```

`checkins.booking_id` is a foreign key onto the **personal** bookings table, so
corporate ids could not be stored. Every corporate check-in recorded as
`front_desk` whatever the source, and because `checkinCountFor` inner-joined
`checkins` to `bookings`, corporate attendees never appeared in the trainer's
headcount.

**Fix:** added a nullable `checkins.corporate_booking_id`, recorded the real
source, and rewrote `checkinCountFor` to count both. This is the one schema
change; it is additive and existing rows keep their data.

---

<a id="11"></a>
## 11. Money moved without transactions — **High**

**Where:** all booking mutations

Each was several independent writes: insert a booking, then debit credits;
cancel, refund, promote, charge. A failure in between left a class that cost
nothing, or credits that vanished.

Worse, the balance was *read* before the transaction and charged inside it, so
two concurrent bookings could both read the old balance and each debit from it —
a classic lost update.

**Fix:** every mutation that moves credits runs inside `db.transaction()`, and
every read that decides the outcome happens inside it.

> Note for anyone touching the tests: `db.transaction()` does not work against a
> `:memory:` libSQL database — the tables are gone once the transaction commits.
> Each test gets its own temporary database *file* for that reason.

---

<a id="12"></a>
## 12. Schedule page refetched for ever — **High**

**Where:** `app/schedule/page.tsx`, `reschedule-modal.tsx`

```tsx
trpc.classes.list.useQuery({ from: new Date().toISOString() })
```

The timestamp is built during render, so it differed every time. React Query
keys its cache on the input: every render was a new query with no cached data →
fetch → re-render → new key → fetch. Opening `/schedule` produced a continuous
stream of requests, one every ~30ms, for as long as the tab was open. The `from`
value creeping forward by milliseconds in the server log is the tell.

**Fix:** `useNowIso()` freezes the value for the lifetime of the mount.

---

<a id="13"></a>
## 13. Corporate bookings invisible in `spotsLeft` — Medium

`classes.list` counted only personal bookings, so a class filled by corporate
members still advertised free spots. Both tables are now counted.

---

<a id="14"></a>
## 14. Checked-in attendees freed up their spot — Medium

`classes.list` counted `status = 'booked'` while the utilisation report counted
`'booked'` and `'attended'`. Marking someone attended dropped them from the
schedule's count, `spotsLeft` went up, and the class could be over-booked as
people arrived. Everything now counts `('booked','attended')`.

---

<a id="15"></a>
## 15. Three of four notification types never sent — Medium

The schema declares `waitlist_promotion`, `class_cancelled`,
`membership_expiring` and `announcement`. Only `announcement` was ever written
by running code — the seed file contained examples of all four, which made the
feature look finished.

**Fixed:** `waitlist_promotion` and `class_cancelled` are now raised at the
points those things happen, via `notifications/server/notify.ts`. Notifications
are sent after the transaction that did the real work, so failing to tell
someone can never undo the thing they are being told about.

**Still open:** `membership_expiring` needs something to run on a schedule and
this app has no scheduler. `admin.expiringMemberships` already finds the right
people, so it is a cron job away.

---

<a id="16"></a>
## 16. Kiosk turned away members who had already paid — Medium

Check-in was disabled when the member's balance hit zero or their membership had
lapsed. But checking in costs nothing — the credit was spent at booking time. A
member on a 10-credit pack who had booked all ten classes was refused entry to
classes they had already paid for. The warnings remain; they no longer disable
the button.

---

<a id="17"></a>
## 17. Announcements went to deactivated accounts — Medium

`broadcast` named its variable `activeMembers` and filtered only on role. Closed
accounts received every announcement and inflated the "sent to N members" count.
Now filtered on `active` too.

---

<a id="18"></a>
## 18. Waitlist positions could tie — Low

Position counted rows with a strictly earlier `bookedAt`, which defaults to
SQLite's `CURRENT_TIMESTAMP` and resolves only to the second. Two people joining
within the same second saw the same position, and the promotion order between
them was undefined. Both now rank on `(bookedAt, id)`.

---

<a id="19"></a>
## 19. Reschedule picker offered the class you were already on — Low

The picker filtered by class name only. The original code's own comment claimed
it excluded the current class; it did not. Selecting it produced "You are
already booked for this class." Now excluded by id.

---

<a id="20"></a>
## 20. Company member picker offered staff — Low

The picker listed every search result, but the server refuses to link anyone who
is not a member, so trainers and admins appeared as options that could only
fail. Now filtered to members.

---

<a id="21"></a>
## 21. Stray `0` beside the notification bell — Low

`{count && count > 0 && …}` evaluates to the number `0` when the count is zero,
and React renders numbers. Every user with nothing unread saw `🔔0`. Now a
ternary.

---

<a id="22"></a>
## 22. Three CSS classes and two variables never defined — Low

`.btn-sm`, `.btn-danger` and `.btn-outline` were used 8, 1 and 4 times and
defined neither in `globals.css` nor by Tailwind, so those buttons rendered
unstyled. `--bg-secondary` and `--fg` were referenced but never declared, so
every rule using them was dropped and the kiosk and trainer inputs fell back to
browser defaults. All now defined.

---

<a id="23"></a>
## 23. Sessions accumulated for ever — Low

Every login inserted a row and nothing ever deleted one. Login now clears that
user's expired sessions.

---

<a id="24"></a>
## 24. Availability check loaded every class ever taught — Low

`checkAvailability` fetched a trainer's entire history to check one slot, then
filtered in JavaScript. Now scoped to the relevant day in SQL.

---

<a id="25"></a>
## 25. Known issues left open

Deliberately not changed, with reasons.

- **`membership_expiring` notifications** — needs a scheduler (see [15](#15)).
- **Capacity is still racy under true concurrency.** The check is `count(*)` then
  `insert`; a transaction narrows the window but SQLite's default isolation does
  not close it. Closing it properly wants a unique constraint or serialised
  writes. For a single-site gym this is unlikely rather than impossible.
- **`lookupByEmailOrPhone` matches `LIKE %term%` and returns the first row.**
  Searching `9` at the front desk returns an arbitrary member. Exact matching
  would break the partial phone search the kiosk depends on; fixing it properly
  means returning a list for the desk to choose from, which is a UI change.
- **Trainer availability assumes the studio runs on UTC.** Stored as a weekday
  plus `HH:MM` with no timezone, compared against UTC components of the class
  start. For a studio in IST, 06:00–12:00 really means 11:30–17:30 local. The
  seed data hides it because seeded classes are generated at UTC hours too.
  Needs a studio timezone to exist as a concept first; the assumption is written
  down in `trainers/server/availability.ts`.
- **`payments.refund` cancels the membership but leaves its bookings.** A
  refunded member keeps classes they already booked. A policy call.
- **`classes.update` lets any trainer edit any class,** including reassigning it
  to another trainer, and can set capacity below the number already booked.
- **`adminCompanies.unlinkMember` leaves that member's future corporate bookings
  in place.**
- **`members.byId` orders memberships by `startDate`, `members.profile` by
  `endDate`.** The kiosk reads `[0]` from the former, so an unusual overlap of
  memberships could show the wrong one.
- **`admin.topTrainers` labels its count "classes taught"** but counts classes
  that had at least one attendee.
- **`auth.register` works but nothing links to it.** No sign-up page exists.
- **Mixed timestamp formats.** `bookedAt` is written by SQLite as
  `YYYY-MM-DD HH:MM:SS`, `cancelledAt` by the app as an ISO string; they sort
  differently as text. Normalising means a data migration, and the ordering
  problem it caused is fixed at the query level instead.
- **The session cookie is not marked `secure`.** Correct for local HTTP
  development; wrong for any real deployment.
