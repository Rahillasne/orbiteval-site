# Release-ledger reconstruction from a regulator-mandated record
## NHTSA Standing General Order, all reporting operators — 2026-09-21

**Claim under test.** A regulator-mandated incident record can reconstruct
deployment release transitions, but the raw vendor version field requires an
independent release ledger before it is analytically trustworthy.

**Verdict: supported, and more strongly than expected.** Of 17 reporting
operators, exactly one produced a record on which a before/after release
comparison is arithmetically possible at all — and even that one cannot
resolve the effect it appears to show.

---

## Snapshot

    file    SGO-2021-01_Incident_Reports_ADS.csv
    source  https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/
    sha256  f856d0b9cedc5f4447515c200eeacdff5d4cabf63003dcac207385eb466ff7f5
    pulled  2026-09-21
    span    incidents APR-2025 .. AUG-2026

NHTSA republishes this file monthly. Every number below is pinned to that
hash; re-running against a later pull will not reproduce them and should not
be expected to.

Reproduce: `python3 ledger.py` (stages 1-2), `python3 timeline_outcomes.py`
(stages 3-4).

## Stage 1 — deduplication

    rows in file                                    1478
    after keeping latest Report Version per ID      1437   (-41 superseded revisions)
    after collapsing Same Incident ID               1436   (-1 duplicate incident)

Report revisions reach version 5. Reporting Entity and Operating Entity are
distinct fields and disagree: Avride appears as both `Avride Inc.` and
`Avride Inc`, Tesla as `Tesla, Inc.` and `Tesla Inc`. The entity field needs
the same normalisation as the version field.

**Sensitivity.** Every Stage 4 verdict is unchanged by deduplication. The
headline metric moves from 8/882 vs 5/186 (Fisher p=0.059) to 8/875 vs 5/186
(p=0.061). No conclusion depends on the dedup rule.

## Stage 2 — field coverage

On the deduplicated record (n=1436):

| state | n | share |
|---|---|---|
| publicly observable value | 1369 | 95.3% |
| redacted as confidential business information | 35 | 2.4% |
| present but carries no version token (e.g. `ADS`) | 28 | 1.9% |
| placeholder (`-`) | 4 | 0.3% |
| **field present** | **1436** | **100.0%** |

So: **100% field coverage, 95.3% publicly observable.** Not "100% usable".

## Stage 2b — normalisation is not optional, and not automatable

Waymo's 1,211 reports carry **13 distinct raw strings**. Merging on formatting
alone — case and punctuation — collapses them to **9**. Human adjudication of
the flagged near-duplicates gets to **5 real releases**.

Formatting merges (safe, automatic):

    '5th Generation ADS, Version 10'  <-  '5th Generation ADS Version 10' x13
                                          '5th Generation ADS,  Version 10' x3
                                          '5th Generation ADS,Version 10' x2

Flagged for a human, never merged automatically — 44 pairs across all
operators, of which exactly **one** is a pure text variant and the rest differ
in their digits and are probably genuinely distinct releases:

    '5th Generation ADS, Version 10'  vs  '5th Genearation ADS, Version 10'   text only
    '5th Generation ADS, Version 10'  vs  '35th Generation ADS, Version 10'   DIGITS DIFFER

The second pair is the important one. An automated rule must keep
`35th Generation` as its own release, because a changed digit is exactly how a
real version differs from its neighbour. Only a human who knows Waymo has no
35th-generation vehicle can resolve it. **A ledger is a field plus a
normalisation step plus a named human who signed off on it.**

## Stage 3 — the version field fails in three different ways

| operator | reports | releases | failure mode |
|---|---|---|---|
| Waymo | 1211 | 5 | usable |
| Zoox | 64 | **64** | too fine — one unique build per incident |
| May Mobility | 18 | 15 | too fine |
| Avride | 79 | 8 | scheme changed mid-record (`v1.0` -> `RC-xx-xx`, Apr 2026) |
| Tesla | 26 | 0 | too coarse — every report says `ADS`, no version |
| Motional, Aurora, Nuro, Stack AV, PlusAI, Oxbotica, Hyundai | 30 | 0 | fully redacted as CBI |

Only Waymo's record supports arms. Zoox reports a distinct build string for
every single incident, so its release arms have size 1 by construction and no
comparison between Zoox releases can ever be made from this record.

Waymo's reconstructed rollout, from public records with no vendor cooperation:

    5th Gen Version 9     2025-04 .. 2025-06      5 reports
    5th Gen Version 10    2025-06 .. 2026-05    904 reports
    6th Gen Version 10    2025-10 .. 2026-03      5 reports
    5th Gen Version 11    2026-03 .. 2026-08    274 reports
    6th Gen Version 11    2026-04 .. 2026-07     20 reports

Crossover months (more than one release live): 2025-06, 2025-10, 2026-02
through 2026-07. The v10 -> v11 changeover runs March to May 2026.

## Stage 4 — release-linked outcomes, and what they cannot settle

Arm A = 5th Gen Version 10, 2025-06..2026-04, 875 incidents.
Arm B = 5th Gen Version 11, 2026-06..2026-07, 186 incidents.
Transition months excluded from both arms.

| metric | v10 | v11 | diff | 95% CI | Fisher p | verdict |
|---|---|---|---|---|---|---|
| any injury alleged | 10.17% | 6.99% | −3.18pp | [−7.36, +0.99] | 0.218 | inside noise |
| moderate-or-worse injury | 0.91% | 2.69% | +1.77pp | [−0.63, +4.18] | 0.061 | inside noise |
| air bags deployed | 4.46% | 5.38% | +0.92pp | [−2.60, +4.44] | 0.566 | inside noise |
| a vehicle was towed | 54.51% | 58.60% | +4.09pp | [−3.72, +11.90] | 0.330 | inside noise |

Moderate-or-worse injury **tripled**, 0.91% to 2.69%. It is five events and it
does not survive its own interval.

Smallest difference these arm sizes could have detected, 80% power, alpha 0.05:

    any injury alleged          baseline  9.61%    MDE  6.67pp
    moderate-or-worse injury    baseline  1.23%    MDE  2.49pp
    air bags deployed           baseline  4.62%    MDE  4.75pp
    a vehicle was towed         baseline 55.23%    MDE 11.25pp

The observed +1.77pp sits just under the 2.49pp this record could have
detected. The comparison is not merely inconclusive; it was structurally
incapable of concluding, and that was knowable before looking at the outcome.

Power available to every other operator, for a 1%-baseline outcome:

    Avride         largest two arms 39 vs 12   MDE  9.2pp
    May Mobility   largest two arms  2 vs  2   MDE 27.9pp
    Zoox           largest two arms  1 vs  1   MDE 39.4pp
    all others     no usable release label at all

Their releases would have to make a 1% outcome roughly ten to forty times
worse before this record could show it.

## What this does NOT support

- **No per-mile rates.** SGO carries no exposure. Miles, trips, and hours are
  absent, so nothing here is a rate and no per-mile safety number can be
  derived from it.
- **No safety leaderboard.** Operators differ in fleet size, geography, ODD,
  reporting thresholds and internal review practice. Cross-operator comparison
  of these counts is not meaningful.
- **No causal claim.** Nothing here establishes that a release caused a change
  in outcomes. Arm A spans 11 months and Arm B spans 2, a year apart, with the
  fleet and its operating area growing throughout.
- **No statement about any operator's safety.** The finding is about the
  evidentiary record, not about the vehicles.
- **Q1 is proven only where a regulator compelled it.** Release history can be
  reconstructed when someone is required to record it. That says nothing about
  whether a warehouse would record it, or pay for it.

## What it does establish

1. Compelled version reporting produces 100% field coverage and 95.3%
   publicly observable values.
2. That raw field still needs normalisation and named human adjudication
   before it can be joined — 13 strings to 5 releases for one operator.
3. Release transitions are reconstructable from public records alone, dated to
   the month, with no vendor cooperation.
4. Sixteen of seventeen operators file a version field that cannot support any
   before/after comparison — too fine, too coarse, or redacted.
5. The one operator whose record does support arms produces a comparison whose
   detection limit exceeds the effect being argued about.

Point 5 is the general result, and it is the same result as the policy-eval
work on a completely independent corpus: the record exists, the comparison
looks decidable, and it is not.
