# A release field is not a release ledger

When an automated-driving company ships new software, its vehicles behave
differently the next day. Anyone outside that company who wants to know
whether the change helped has one public place to look. Under a federal
Standing General Order, named manufacturers and operators must file a report
on certain crashes involving their automated-driving systems, and each report
carries a field naming the software version that was running. The field is
called Automation Feature Version. It is the only routinely published,
legally compelled record anywhere of which robot software was deployed when
something went wrong.

We took one snapshot of that record and asked whether an outside analyst can
use it to identify the deployed release and then judge whether a
before-and-after comparison is supported. The version field turns out to be
filled in almost everywhere and usable almost nowhere.

Two terms are worth fixing before the numbers. A release is one immutable
version of the deployed software. An arm is the set of incidents recorded
while a single release was live, which is what a before-and-after comparison
needs two of.

## The record

The snapshot held 1,478 records from 17 reporting operators, covering
incidents from April 2025 to August 2026. Reports get revised, so we kept the
highest report version for each report identifier, which removed 41
superseded revisions. Incidents can be filed more than once, so we then
collapsed records sharing an incident identifier, which removed one more.
That leaves 1,436 reports.

None of the conclusions below depend on those two steps. The central
comparison moves from a Fisher exact p of 0.059 before deduplication to 0.061
after it.

Reporting entity and operating entity are separate fields and they disagree
with each other. Avride appears as both "Avride Inc." and "Avride Inc",
Tesla as both "Tesla, Inc." and "Tesla Inc". The entity field needs the same
cleaning as the version field.

## The field is filled in, which is not the same as analysable

Every one of the 1,436 reports carries something in the version field. That
is complete coverage, and it answers a real question: where a regulator
compelled the release to be named, the release got named.

Of those, 1,369 carry a publicly observable value, which is 95.3 percent.
Thirty-five are redacted as confidential business information, twenty-eight
contain no version token at all, and four hold a placeholder. So the honest
summary is complete field coverage with 95.3 percent publicly observable
values, and not a claim that the field is usable.

## One operator of seventeen has release arms at all

The field fails in three unrelated ways, and the failures are more damaging
than the redactions.

Waymo filed 1,211 reports naming five releases. Zoox filed 64 reports naming
64 distinct build strings, one for every incident, so its arms have size one
by construction and no amount of further waiting will change that. May
Mobility filed 18 reports naming 15 releases. Avride filed 79 reports naming
eight releases and changed its versioning scheme partway through the record,
from a plain "v1.0" to release-candidate dates. Eight operators filed 56
reports carrying no usable release label at all: Tesla's 26 reports each say
only "ADS" with no version, and 30 reports across seven other operators are
redacted in full. Five more operators filed between one and four reports
each, which is a label without a comparison.

Only Waymo's record supports two arms.

## Normalisation needs a human, and the reason is arithmetic

Waymo's 1,211 reports carry 13 distinct raw strings. Merging on formatting
alone, meaning case and punctuation, collapses them to nine. Getting from
nine to five requires someone to make judgment calls.

The formatting merges are safe and automatic. One release absorbs a variant
with the comma missing, a variant with two spaces instead of one, and a
variant with no space after the comma.

The remaining cases cannot be automated, and the reason is worth stating
plainly. We flagged 44 near-duplicate pairs across all operators and merged
none of them, because a one-character difference is exactly how "Version 10"
differs from "Version 11". Merging on edit distance would destroy the
releases the analysis exists to recover. Exactly one of those 44 pairs is a
pure text variant, a misspelling of "Generation". The decisive case is a
report filed under "35th Generation ADS, Version 10". Its digits differ from
its neighbour's, so any automated rule must keep it as a separate release.
Only a person who knows that Waymo has no 35th-generation vehicle can resolve
it.

A ledger is therefore a field, plus a normalisation step, plus a named person
who signed the judgment calls, plus the original strings kept alongside the
canonical ones.

## The rollout is visible without the vendor's help

From public records alone, dated to the month, Waymo's fifth-generation
Version 9 appears from April to June 2025, Version 10 runs from June 2025 to
May 2026 across 904 reports, Version 11 appears in March 2026 and is still
running in August across 274 reports, and two sixth-generation releases run
alongside them in small numbers. The changeover from Version 10 to Version 11
occupies March through May 2026, with both live at once.

That much works. Release history can be reconstructed by an outsider when
somebody was required to write it down.

## The one comparison that exists could not have concluded

Setting the transition months aside leaves 875 incidents under Version 10 and
186 under Version 11. Across four outcome measures, nothing separates them.
Alleged injuries fall from 10.17 to 6.99 percent, with a 95 percent interval
on the difference running from minus 7.36 to plus 0.99 points. Airbag
deployments and vehicle tows move by about a point and four points, both
intervals spanning zero.

The measure that looks alarming is moderate-or-worse injury, which rises from
0.91 to 2.69 percent. That is a tripling, and it rests on five events. Its
interval runs from minus 0.63 to plus 4.18 points and its Fisher exact p is
0.061.

The important number is the one that comes before the outcome. Given these
two arm sizes and that baseline, the smallest difference detectable at 80
percent power and a 5 percent level is 2.49 points. The observed difference
is 1.77 points. The comparison was not merely inconclusive. It was incapable
of concluding, and that was knowable before anyone looked at an injury
column.

For every other operator the position is worse by an order of magnitude. On a
one-percent outcome, Avride's two largest arms could detect a 9.2-point
difference, May Mobility's a 27.9-point difference, and Zoox's a 39.4-point
difference. Their releases would have to make a rare outcome ten to forty
times more common before this record could show it.

## The missing denominator

The record carries no miles, no operating hours, no trips and no fleet size.
Without exposure there is no rate, so nothing here is a per-mile number and
none can be derived. Fleet size and operating area both grew across the
window, the two arms are eleven months and two months long, and they sit a
year apart.

## What this does not establish

No per-mile safety rates. No operator ranking, because operators differ in
fleet size, geography, operating domain and internal review practice. No
causal claim that any release changed any outcome. No statement about the
safety of any vehicle or company, because the subject here is the evidentiary
record and not the machines. And no conclusion about whether anyone outside a
regulated industry would keep such a record, or pay to have it checked. The
version field exists here because a federal order required it.

## What it establishes

Compelled version reporting produces complete field coverage and 95.3 percent
publicly observable values. That raw field still needs normalisation and
named human adjudication before it can be joined, thirteen strings reducing
to five releases for a single operator. Release transitions are
reconstructable from public records alone. Sixteen of seventeen operators
file a version field that cannot support a before-and-after comparison,
because it is too coarse, too fine, or withheld. And the one record that can
support arms produces a comparison whose detection limit is larger than the
effect under discussion.

The last of those is the general result. A record can exist, be complete, be
legally compelled, and still be unable to answer the question it appears to
answer.

## Reproducing this

Source: `SGO-2021-01_Incident_Reports_ADS.csv` from
`https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/`, pulled 21 September 2026.

    sha256  f856d0b9cedc5f4447515c200eeacdff5d4cabf63003dcac207385eb466ff7f5

NHTSA republishes this file monthly, so every number above is pinned to that
hash and a later pull will not reproduce them. The deduplication logic,
canonicalisation, near-duplicate flagging, timeline reconstruction and power
calculations run as `ledger.py` and `timeline_outcomes.py`.

This is not a safety certification and it does not stand in for a regulator,
a notified body, or a machinery-safety assessment.
