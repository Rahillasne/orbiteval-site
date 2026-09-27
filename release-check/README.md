# SGO release check

An independent audit of NHTSA's public automated-driving incident record,
asking whether an outsider can identify which software release was deployed
and whether a before-and-after comparison is supported.

    python3 verify.py     # asserts every number published in POST.md, exits non-zero on mismatch
    python3 ledger.py     # stages 1-2: deduplication, field coverage, canonicalisation
    python3 timeline_outcomes.py   # stages 3-4: release timeline, outcomes, detection limits

## Snapshot

    file    ads.csv  (SGO-2021-01_Incident_Reports_ADS.csv, unmodified)
    source  https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/
    pulled  2026-09-21
    sha256  f856d0b9cedc5f4447515c200eeacdff5d4cabf63003dcac207385eb466ff7f5

NHTSA republishes this file monthly and overwrites it in place, so the
snapshot is committed here. Without it the hash is unverifiable after the next
republish and none of the figures can be checked.

`FINDINGS.md` is the working record. `POST.md` is the published write-up.
