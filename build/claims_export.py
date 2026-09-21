"""Export the Claim Check data file for orbiteval.com.

Reads the audit modules from the sensitivity study and writes
`claims-data.json` into the site root. Nothing is computed here that the
study does not already compute: this script imports `claims`, `core` and
`reference` and copies out what they return, so the page cannot drift from
the code that produced the paper.

The one thing this script does add is the `venue` field, and it is derived
here rather than read from the corpus, because the corpus does not record
it. The derivation is by benchmark name and is deliberately conservative:
anything not recognised is "unstated", never guessed. The page prints the
rule next to the column.

Usage:
    python3 build/claims_export.py [--study PATH] [--out PATH]

The study defaults to the aistats worktree, which is where the modules are
checked out. This script only ever reads from it.
"""
import argparse
import datetime
import hashlib
import json
import os
import sys

DEFAULT_STUDY = os.path.expanduser(
    "~/Orbit-Research-aistats/research/sensitivity_2026-09-19")
DEFAULT_OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "claims-data.json")

# Benchmarks whose episodes are simulated. Matching is on the lowercased
# claim text. A claim that matches nothing here is "unstated" — it is not
# assumed to be either kind.
SIMULATION_MARKERS = ("libero", "robocasa", "metaworld", "meta-world")
PHYSICAL_MARKERS = ("real-world", "real world")


def derive_venue(claim_text):
    """One of "simulation_benchmark", "physical_robot", "unstated".

    Physical markers win over simulation markers: a claim that says
    "real-world" is a physical claim even if it also names a simulator,
    because the simulator may only be the baseline's origin.
    """
    t = claim_text.lower()
    if any(m in t for m in PHYSICAL_MARKERS):
        return "physical_robot"
    if any(m in t for m in SIMULATION_MARKERS):
        return "simulation_benchmark"
    return "unstated"


# The four positive states, in the order the page lists them, with the
# sentence the page prints. The wording is the study's, restated for a
# reader who has not read the paper. No state is called "false".
STATE_COPY = {
    "survives": {
        "label": "Supported",
        "line": "The reported gain is larger than retraining noise at the "
                "harshest coefficient anyone has measured.",
    },
    "inconclusive": {
        "label": "Inconclusive",
        "line": "The reported gain sits inside the range of retraining "
                "noise observed across external sources. Eight cells cannot "
                "pin down one number, and the honest answer is the range.",
    },
    "erased": {
        "label": "Not supported",
        "line": "The reported gain is smaller than retraining noise even "
                "under the most forgiving coefficient anyone has measured.",
    },
    "fails_on_episode_noise": {
        "label": "Not supported",
        "line": "The reported gain does not clear the noise in its own "
                "episode count, before retraining variation is considered "
                "at all.",
    },
    "negative_gain": {
        "label": "Reported loss",
        "line": "The authors report a decrease. Listed for completeness and "
                "excluded from the tally.",
    },
}


def build(study_path):
    sys.path.insert(0, study_path)
    import claims  # noqa: E402
    import core  # noqa: E402
    import reference  # noqa: E402

    band_lo, band_med, band_hi = claims.coefficient_band()

    rows = []
    for c in claims.CLAIMS:
        state = claims.classify(c)
        s = core.sigma_star(
            delta=c.delta_pp / 100.0, n=c.n_episodes, p=c.base_rate)
        rows.append({
            "citation_key": c.citation_key,
            "paper": c.paper,
            "claim": c.claim,
            "delta_pp": c.delta_pp,
            "n_episodes": c.n_episodes,
            "base_rate": c.base_rate,
            "level": c.level,
            "provenance": c.provenance,
            "venue": derive_venue(c.claim),
            # sigma-star: the smallest retraining SD that would erase the
            # reported gain. None when the gain fails on episode noise alone.
            "sigma_star_pp": None if s is None else round(s * 100.0, 4),
            # The band conditioned on THIS claim's base rate, which is what
            # sigma-star is actually compared against.
            "band_lo_pp": round(
                claims._reference_sigma_pp(band_lo, c.base_rate), 4),
            "band_hi_pp": round(
                claims._reference_sigma_pp(band_hi, c.base_rate), 4),
            "state": state,
            "state_label": STATE_COPY[state]["label"],
            "state_line": STATE_COPY[state]["line"],
        })

    summary = claims.summary()
    # The audit is also reported with the band's lower edge at zero, which
    # is the most forgiving floor a reader could ask for: at that floor
    # nothing can be erased by retraining noise at all.
    summary_at_zero = claims.summary_at_floor(0.0)

    null_ref = None
    cal_path = os.path.join(study_path, "out", "calibration.json")
    if os.path.exists(cal_path):
        with open(cal_path) as f:
            cal = json.load(f)
        by_j = cal.get("by_J", {})
        null_ref = {
            "panel": cal.get("panel"),
            "nominal_alpha": cal.get("nominal_alpha"),
            "by_retrains": [
                {
                    "retrains_per_arm": int(k),
                    "episodes_per_cell": v.get("n"),
                    "n_tasks": v.get("n_tasks"),
                    "n_cells": v.get("n_cells"),
                    "episode_level_reject": v.get("pooled_episode_reject"),
                    "retrain_level_reject": v.get("retrain_level_reject"),
                }
                for k, v in sorted(by_j.items(), key=lambda kv: int(kv[0]))
            ],
        }

    corpus_path = os.path.join(study_path, "audit_corpus.json")
    with open(corpus_path, "rb") as f:
        corpus_bytes = f.read()
    corpus_hash = hashlib.sha256(corpus_bytes).hexdigest()
    corpus = json.loads(corpus_bytes)

    return {
        "generated": datetime.date.today().isoformat(),
        "protocol_version": 1,
        "corpus_sha256": corpus_hash,
        "corpus_note": corpus["_README"],
        "n_papers_screened": reference.N_SCREENED,
        "n_claims": len(rows),
        "summary": summary,
        "summary_at_zero_floor": summary_at_zero,
        "band": {
            "coef_min": band_lo,
            "coef_median": band_med,
            "coef_max": band_hi,
            "n_cells": len(reference.coefficient_cells()),
            "sources": reference.coefficient_sources(),
            "note": "sigma_retrain = coef * 100 * sqrt(p(1-p)). The three "
                    "coefficients are derived from the external cells at "
                    "import time, never typed.",
        },
        "null_reference": null_ref,
        "claims": rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--study", default=DEFAULT_STUDY)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    data = build(args.study)
    with open(args.out, "w") as f:
        json.dump(data, f, indent=1)
        f.write("\n")

    # The page reads the .js wrapper so it renders from a file:// URL as
    # well as over http. The .json beside it is the downloadable evidence,
    # and both are written from the same object so they cannot disagree.
    js_out = os.path.splitext(args.out)[0] + ".js"
    with open(js_out, "w") as f:
        f.write("// Generated by build/claims_export.py. Do not edit.\n")
        f.write("window.CLAIM_CHECK = ")
        json.dump(data, f, indent=1)
        f.write(";\n")

    s = data["summary"]
    print("wrote {} ({} claims, {} papers screened)".format(
        args.out, data["n_claims"], data["n_papers_screened"]))
    print("  " + ", ".join("{}={}".format(k, v) for k, v in s.items()))


if __name__ == "__main__":
    main()
