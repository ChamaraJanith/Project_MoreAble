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
| Community  | 30%    | `reports` where `busId` matches, VERIFIED only | 50 |
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

Only `VERIFIED` reports that name this bus count. `PENDING`, `REJECTED` and
every other status are ignored, as are reports with no `busId`. A report is
positive when `type === 'POSITIVE'` (`reportTypeOf`); anything else is an
issue.

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
(`tallyVerifiedCommunityReports`, `tallyPassengerRatings`) and caches per
request. Its callers are:

- `POST /api/journeys/search`
- `GET /api/booking/options`
- `GET /api/booking/seats/:tripId`

## Not yet supplied

Community Reporting does not yet record which facility an issue concerns, or
when an issue is resolved. So today no caller supplies `unavailableFacilities`,
and the facility factor reflects the configured bus record. When that data
exists, the loader should add the facilities with an active verified issue to
the evidence it returns. The formula does not change.
