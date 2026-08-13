# Bugs found in the existing code

These were found while working out what the app did. They were first written up
and left alone, so the restructure could be verified against unchanged
behaviour; they have since been fixed as a separate, deliberate step.

Each entry says what was wrong, how it showed up, and what changed. **The
"Behaviour change" lines are the ones to read** — several of these alter numbers
on screen or where money goes, which is exactly why they were a decision rather
than part of a silent cleanup.

Anything still open is in [Left alone](#left-alone) at the bottom, with reasons.

---

## 1. Class utilisation on the admin dashboard was wrong ✔ fixed

**Where:** `back-office/server/dashboard-stats.ts`, `classUtilisation`

The `booked` count was a correlated subquery:

```ts
booked: sql`(select count(*) from ${bookings}
             where ${bookings.classId} = ${classes.id} …)`
```

Drizzle only qualifies column names when the outer query has a join. This query
had none, so it emitted:

```sql
select count(*) from "bookings" where "class_id" = "id" …
```

Inside the subquery both names resolve to `bookings`, so
`bookings.class_id = classes.id` became `bookings.class_id = bookings.id`. The
subquery stopped being correlated and **every class reported the same number** —
the count of bookings whose row id happened to equal their own class id.

It went unnoticed because the number was plausible, and because `classes.list`
has the same subquery but *does* have a `leftJoin`, so the public schedule was
right and only the admin view was wrong.

**Fixed by** rewriting it as a `leftJoin` + `GROUP BY` instead of a raw
subquery, which removes the trap rather than working around it. Against the
seeded database the dashboard now reads `0/14  4/20  8/18  0/12  17/20 …`
where it previously showed the same figure for every row, and each figure
cross-checks against that class's roster.

`classes.list` still uses the subquery form and is correct, but only because of
its join. That is now spelled out in a comment so nobody removes the join.

**Behaviour change:** utilisation percentages on `/admin` change, to correct
values.

---

## 2. Corporate check-ins lost their source and their booking link ✔ fixed

**Where:** `corporate/server/corporate-bookings.router.ts`, `markAttended`

```ts
.input(z.object({ …, source: z.enum([...]).default("front_desk") }))
await ctx.db.insert(checkins).values({
  userId: booking.userId,
  bookingId: null,     // corporate ids can't go here
});                     // input.source silently dropped
```

`checkins.booking_id` is a foreign key onto the **personal** `bookings` table,
so a corporate booking id could not be stored in it. Every corporate check-in
recorded as `front_desk` regardless of where it happened, and because
`checkinCountFor` inner-joined `checkins` to `bookings`, corporate attendees
never appeared in the headcount a trainer sees.

**Fixed by** adding a nullable `checkins.corporate_booking_id` column pointing
at `corporate_bookings`, writing the real source, and rewriting
`checkinCountFor` to count both kinds. This is the one change that touches the
schema; it is additive, existing rows keep their data, and `pnpm db:push` has
been run (96 seeded check-ins survived).

**Behaviour change:** trainers' check-in counts go up where corporate members
attended — they were previously undercounted.

---

## 3. Cancelling a class took members' credits with it ✔ fixed

**Where:** `classes/server/classes.router.ts`, `cancel`

Cancelling a class set every confirmed booking to `cancelled` and refunded
nothing. A member who paid two credits for a class the *studio* then called off
was simply out two credits — the studio cancelling was treated worse than the
member cancelling, which refunds outside the 12-hour window. Waitlisted members
were left queuing for a class that would never run, and corporate bookings were
not touched at all: they stayed `booked` against a cancelled class, with the
employer's credits still spent.

**Fixed:** cancellation now refunds unconditionally — the member did nothing
wrong, so the 12-hour rule does not apply — cancels waitlisted rows too, and
cancels corporate bookings, returning their credits to the employer's pool. All
of it in one transaction.

**Behaviour change:** members and companies get credits back when the studio
cancels a class. Money moves that previously did not.

---

## 4. Three of the four notification types were never sent ✔ two fixed, one open

**Where:** `db/schema/notifications.ts` vs. the rest of the app

The schema declared `waitlist_promotion`, `class_cancelled`,
`membership_expiring` and `announcement`. Only `announcement` was ever produced
by running code — the seed file contained examples of all four, which made the
feature look finished. A member promoted off a waitlist was never told; nor was
one whose class had been cancelled.

**Fixed:** a small `notifications/server/notify.ts` service, called from the two
places where those events actually happen. Notifications are raised after the
transaction that did the real work, so failing to tell someone can never undo
the thing they are being told about.

`membership_expiring` is **still not sent** — it needs something to run on a
schedule, and there is no scheduler in this app. `admin.expiringMemberships`
already finds the right people, so this is a cron job away.

---

## 5. Waitlist promotion could overdraw a member ✔ fixed

**Where:** `memberships/server/membership-credits.ts`, `bookings/server/waitlist.ts`

Promotion charged `Math.max(0, balance - cost)`, so a member with one credit
promoted into a three-credit class was charged one credit and given the class,
silently. The corporate path handled the same situation differently again: if
the pool could not cover the class, the promotion went ahead and **nothing** was
charged, so the employer got the class free.

Two paths, two different accidental answers.

**Fixed** with one rule for both: promote the longest-waiting member *who can
still pay*, and pass over anyone who cannot. Someone without the credits could
not book the class through the front door either, so handing them the spot and
taking whatever is left in their balance is worse than moving to the next
person. If nobody in the queue can pay, the spot stays open. `Math.max(0, …)`
is gone.

**Behaviour change:** a member or company that cannot afford the class is now
skipped rather than promoted.

---

## 6. The kiosk turned away members who had already paid ✔ fixed

**Where:** `app/kiosk/page.tsx`

```ts
disabled={markAttended.isPending || isMembershipExpired || hasNoCredits}
```

Checking in costs nothing — the credit is spent at booking time. A member on a
10-credit pack who had booked all ten classes had a balance of 0 and was refused
entry at the desk for classes they had already paid for. Likewise a member whose
membership lapsed after they booked.

**Fixed:** the warnings stay (they are useful context for the front desk) but no
longer disable the button. The booking is the proof of payment.

---

## 7. Attendance freed up spots on the public schedule ✔ fixed

`classes.list` counted `status = 'booked'` while `classUtilisation` counted
`'booked'` and `'attended'`. Once the desk marked someone attended they dropped
out of the schedule's count, `spotsLeft` went up, and a full class could be
over-booked as people arrived.

**Fixed:** both count `('booked','attended')`, as does the capacity check used
when booking.

**Behaviour change:** classes stay full once attendees are checked in.

---

## 8. Booking was not atomic ✔ fixed (races partly)

Booking and cancelling were each several independent writes with no transaction:
insert a booking, then debit credits; or cancel, refund, promote, charge. A
failure in between left a class that cost nothing, or credits that vanished.

**Fixed:** every mutation that moves money runs inside `db.transaction()`.

The capacity check is still `count(*)` followed by `insert` — now inside a
transaction, which narrows the window but does not close it under SQLite's
default isolation. For a single-site gym this is unlikely rather than
impossible; closing it properly wants a unique constraint or serialised writes.

> Worth knowing if you touch the tests: `db.transaction()` does not work against
> a `:memory:` libSQL database — the tables are gone once the transaction
> commits. The test harness gives each test its own temporary database *file*
> for that reason, which also matches how the app really runs.

---

## 9. Announcements went to deactivated members ✔ fixed

`broadcast` named its variable `activeMembers` and then filtered only on role,
so closed accounts received every announcement and were counted in the "sent to
N members" figure. Now filtered on `active` as well.

**Behaviour change:** the reported recipient count drops where deactivated
members exist.

---

## 10. Waitlist positions could tie ✔ fixed

Queue position counted rows with a strictly earlier `bookedAt`. That column
defaults to SQLite's `CURRENT_TIMESTAMP`, which resolves to the second, so two
people joining within the same second were shown the same position, and the
promotion order between them was undefined.

**Fixed:** both the displayed position and the promotion order now rank on
`(bookedAt, id)`.

---

## 11. The schedule page refetched `classes.list` for ever ✔ fixed

**Where:** `app/schedule/page.tsx` and `reschedules/ui/reschedule-modal.tsx`

```tsx
trpc.classes.list.useQuery({ from: new Date().toISOString() })
```

The timestamp is built during render, so it differs every time. React Query
keys its cache on the input, so each render produced a brand-new query with no
cached data, fetched, re-rendered with the result, produced another new key, and
fetched again — a loop that never settles. Opening `/schedule` sent a continuous
stream of requests for as long as the tab was open, one every ~30ms:

```
GET /api/trpc/classes.list?…"from":"2026-08-13T20:55:52.886Z" 200 in 22ms
GET /api/trpc/classes.list?…"from":"2026-08-13T20:55:52.915Z" 200 in 23ms
GET /api/trpc/classes.list?…"from":"2026-08-13T20:55:52.948Z" 200 in 25ms
```

Note the `from` value creeping forward by milliseconds — that is the tell.

**Fixed** with `useNowIso()` (`lib/hooks/use-now-iso.ts`), which freezes the
value for the lifetime of the mount. These screens ask "what is on from now
onwards"; the answer does not need to change on every render, and React Query's
own invalidation already refreshes the list after a booking.

---

## 12. Smaller fixes

- **`.btn-sm`, `.btn-danger`, `.btn-outline` did not exist.** Used 8, 1 and 4
  times, defined neither in `globals.css` nor by Tailwind, so those buttons
  rendered unstyled. Now defined. *(Visual change — those buttons look
  different, which is to say they now look like buttons.)*
- **`--bg-secondary` and `--fg` were never declared**, so every rule using them
  was dropped and the kiosk and trainer inputs fell back to browser defaults.
  Now declared in `globals.css`.
- **A stray `0` next to the notification bell.** `{count && count > 0 && …}`
  evaluates to the number `0` when the count is zero, and React renders numbers.
  Every user with nothing unread saw `🔔0`. Now a ternary.
- **`checkAvailability` loaded every class a trainer had ever taught** to check
  one slot, then filtered in JavaScript. Now scoped to the relevant day.
- **Sessions accumulated forever.** Nothing ever deleted them. Login now clears
  that user's expired rows.
- **`reschedules.reschedule` read a membership row it never used.** Removed.

---

## Left alone

Deliberately not changed, with reasons.

- **`lookupByEmailOrPhone` matches on `LIKE %term%` and returns the first row.**
  Searching `9` at the front desk returns an arbitrary member. The obvious fix
  is an exact match — but partial phone search is what makes the kiosk usable,
  and the UI expects exactly one member. Fixing this properly means returning a
  list and having the desk choose, which is a UI change, not a bug fix.
- **Trainer availability assumes the studio runs on UTC.** Availability is
  stored as a weekday plus `HH:MM` with no timezone and compared against UTC
  components of the class start. For a studio in IST a trainer who sets
  06:00–12:00 is really being matched against 11:30–17:30 local. The seed data
  hides it because seeded classes are generated at UTC hours too. Fixing it
  needs a studio timezone to exist as a concept first; the assumption is now
  written down in `trainers/server/availability.ts`.
- **`payments.refund` cancels the membership but leaves its bookings.** A
  refunded member keeps classes they already booked. Arguably correct, arguably
  not — it is a policy call for whoever runs the studio.
- **`auth.register` works but nothing links to it.** There is no sign-up page.
  That is a missing feature, not a defect.
- **Mixed timestamp formats.** `bookedAt` is written by SQLite as
  `YYYY-MM-DD HH:MM:SS`; `cancelledAt` by the app as an ISO string. They sort
  differently as text. Normalising means a data migration, and the ordering
  problem it caused has been fixed at the query level instead.
