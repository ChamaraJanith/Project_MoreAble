# Accessibility Score (MOV-79 / MOV-111)

One whole number from 0 to 100 per bus. Higher means stronger evidence that the
bus is accessible. It is defined once, in `computeAccessibilityScore`
(`src/shared/utils/accessibility.ts`). Every API that returns
`accessibilityScore` calls that function, and nothing else holds a weight or a
formula.

## Formula

```
score = round( clamp_0..100( Facility * 0.50 + Community * 0.30 + Rating * 0.20 ) )
```

Each factor is on a 0–100 scale. There are exactly three factors, and the
weights are fixed.

| Factor     | Weight | Source                                   | No evidence |
|------------|--------|------------------------------------------|-------------|
| Facilities | 50%    | `buses/{busId}.accessibilityFacilities`  | 0 (unavailable) |
| Community  | 30%    | `reports` where `busId` matches: VERIFIED issues + positive feedback | 50 |
| Ratings    | 20%    | `busRatings` where `busId` matches       | 50 |

## 1. Facilities

```
Facility = (effectively available facilities / 8) * 100
```

The 8 facilities are `wheelchairRamp`, `audioAnnouncement`, `lowFloorVehicle`,
`walkingAssistance`, `wheelchairSpace`, `guardianSeats`, `prioritySeats` and
`elderlySeats`. A facility counts only when its value is exactly `true`. For a
counted facility, that means `available === true`, never its count. A value
that is missing, `null`, `'true'` or `1` counts as unavailable.

**Effective availability.** The bus record is the canonical physical
configuration, and scoring never writes to it. A facility is effectively
available when it is configured **and** is not listed in
`evidence.unavailableFacilities`. That list holds the facilities that have an
active verified issue. When an issue is resolved, the facility drops off the
list and its configured state applies again. The list can only take facilities
away; it never adds one.

## 2. Community reports

Only reports that name this bus count, and which ones is decided by
`isCountedCommunityReport` in `src/shared/utils/accessibility.ts`. A report is
positive when `type === 'POSITIVE'` (`reportTypeOf`); anything else is an
issue.

- **Issue reports** need an admin to confirm them. Only `VERIFIED` issues count;
  `PENDING`, `REJECTED` and every other status are ignored. `VERIFIED` means
  the issue was confirmed, not that it was fixed.
- **Positive feedback** needs no admin review. It is filed as `PUBLISHED` and
  counts as filed. It is never stored as `VERIFIED`, because nobody verified
  it. Positive feedback an admin `REJECTED` under the earlier workflow stays
  excluded; legacy positive feedback still stored as `PENDING` or `VERIFIED`
  counts.

Reports with no `busId` never count.

```
n   = positive + issue
raw = positive / n * 100
Community = n == 0 ? 50 : (n/(n+5)) * raw + (5/(n+5)) * 50
```

## 3. Passenger ratings

Only whole 1–5 ratings of this bus count, read through `readBusRating`.

```
avg      = total stars / n
adjusted = n == 0 ? 3 : (n/(n+5)) * avg + (5/(n+5)) * 3
Rating   = (adjusted - 1) / 4 * 100          (1★ -> 0, 3★ -> 50, 5★ -> 100)
```

## Confidence adjustment

Community and ratings use the same Bayesian-style prior: a neutral value (50,
or 3★) that carries the weight of `M = 5` pieces of evidence. A few reports or
ratings move the factor only a little away from neutral. A large, consistent
body of evidence moves it most of the way to the observed value.

A bus with no reports or ratings therefore scores neutral (50) on those
factors, not 0. No evidence is not bad evidence.

## Worked example

6/8 facilities, 8 positive and 2 issue reports, and 20 ratings averaging 4.2:

```
Facility  = 75
Community = 10/15*80 + 5/15*50       = 70
Rating    = (0.8*4.2 + 0.2*3 - 1)/4*100 = 74
score     = 37.5 + 21 + 14.8 = 73.3  -> 73
```

## Where the evidence is loaded

`loadAccessibilityScoreEvidence(adminDb, busId, cache?)` in
`src/shared/server/accessibilityScoreEvidence.ts` reads both collections with
single-field `busId ==` queries. It hands the documents to the pure tallies
(`tallyCommunityReports`, `tallyPassengerRatings`) and caches per
request. Its callers are:

- `POST /api/journeys/search`
- `GET /api/booking/options`
- `GET /api/booking/seats/:tripId`

## When the score is recalculated (MOV-129)

There is no stored current score. Every endpoint above recalculates from the
evidence on each request, so a report reaching `VERIFIED` changes the next
response with nothing to invalidate or refresh.

What the write paths do in addition is record a history snapshot (MOV-113), by
calling `recordAccessibilityScoreSafely` after their own write has succeeded. A
call that changes nothing stores nothing, so these are safe to repeat:

| Event | Snapshot? | Where |
|---|---|---|
| Issue report verified (`VERIFY`) | yes | `app/api/reports/[reportId]/review+api.ts` |
| Report rejected or remarked | no — neither changes what counts | same route, guarded on `VERIFIED` |
| Issue report created / edited | no — an issue is `PENDING` when filed, and a decided one is closed to edits (409) | `app/api/reports/index+api.ts`, `[reportId]+api.ts` |
| Positive feedback created | yes — it counts as filed | `app/api/reports/index+api.ts` |
| Positive feedback edited | yes, for the old and new bus — it can be moved to another bus | `app/api/reports/[reportId]+api.ts` |
| Counted report deleted (verified issue or positive feedback) | yes | `app/api/reports/[reportId]+api.ts` |
| Passenger rating stored | yes | `app/api/journeys/completed/rating+api.ts` |
| Bus facilities changed | yes | `app/api/buses/[busId]+api.ts` |
| Bus created | yes, the baseline entry | `app/api/buses/index+api.ts` |

A report that names no bus, or names a bus that no longer exists, is handled
normally and records nothing. `accessibilityScoreLatest`
exists for change detection only and is never read to answer a score.

## Not yet supplied

Community Reporting does not yet record which facility an issue concerns, or
when an issue is resolved. So today no caller supplies `unavailableFacilities`,
and the facility factor reflects the configured bus record. When that data
exists, the loader should add the facilities with an active verified issue to
the evidence it returns. The formula does not change.
