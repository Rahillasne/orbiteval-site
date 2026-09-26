"""Export the Claim Check data file for orbiteval.com.

The claims come from Corpus 2 v2, read through research/audit_corpus/corpus2.py
in Orbit-Research: the one module allowed to read that file. Everything
computed about a claim comes from the sensitivity study's own functions
(`claims.classify`, `core.sigma_star`, the retraining-noise band and its
per-claim edges), so the page cannot drift from the code behind the paper.
The one number computed here is the pooled rate, the mean of the two rates the
paper printed, which the page labels as exactly that.

A claim whose paper does not state one episode count per arm cannot be sized
against noise. It gets the state `count_not_stated`, no sigma-star and no band,
and is never folded into another state.

v2 corrected v1 on 2026-09-25. v1 printed the midpoint of the two arms as an
unlabelled base rate and carried several wrong counts. v1 stays published at
source/audit_corpus.json; v2 is source/audit_corpus_v2.json.

Usage:
    python3 build/claims_export.py [--study PATH] [--corpus2-dir PATH]
                                   [--bib PATH] [--out PATH]
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from canonical import canonical  # noqa: E402  (needs the path above)

DEFAULT_STUDY = os.path.expanduser(
    "~/Orbit-Research-aistats/research/sensitivity_2026-09-19")
DEFAULT_CORPUS2 = os.path.expanduser("~/Orbit-Research/research/audit_corpus")
DEFAULT_OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "claims-data.json")
# The bibliography the paper already verified against the arXiv API.
DEFAULT_BIB = os.path.expanduser(
    "~/Orbit-Research-aistats/paper/aistats2027/refs.bib")

# Benchmarks whose episodes are simulated. Matching is on the lowercased
# claim text. A claim that matches nothing here is "unstated".
SIMULATION_MARKERS = ("libero", "robocasa", "metaworld", "meta-world")
PHYSICAL_MARKERS = ("real-world", "real world")


def derive_venue(claim_text):
    """One of "simulation_benchmark", "physical_robot", "unstated"."""
    t = claim_text.lower()
    if any(m in t for m in PHYSICAL_MARKERS):
        return "physical_robot"
    if any(m in t for m in SIMULATION_MARKERS):
        return "simulation_benchmark"
    return "unstated"


# The states the page shows, with the sentence it prints. The first five are
# the study's; the sixth exists because v2 records when a paper states no
# single count. No state is called "false".
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
    "count_not_stated": {
        "label": "Count not stated",
        "line": "The paper does not state one episode count per arm for this "
                "comparison, so the gain cannot be sized against noise. It "
                "stays listed rather than being dropped.",
    },
}


def load_sources(bib_path):
    """citation_key -> {title, authors, arxiv, url} from the bibliography."""
    if not os.path.exists(bib_path):
        raise SystemExit(
            "bibliography not found at {}\n"
            "  Source links for every claim are read from it. Pass --bib "
            "PATH.".format(bib_path))
    with open(bib_path) as f:
        bib = f.read()
    out = {}
    for m in re.finditer(r"@\w+\{([^,]+),(.*?)\n\}", bib, re.S):
        key, body = m.group(1).strip(), m.group(2)
        arx = re.search(r"arXiv:([0-9]{4}\.[0-9]{4,5})", body)
        if not arx:
            continue
        title = re.search(r"title\s*=\s*\{(.*?)\}\s*,\s*\n\s*author", body, re.S)
        author = re.search(r"author\s*=\s*\{(.*?)\}\s*,\s*\n\s*\w+\s*=", body, re.S)
        clean = lambda t: re.sub(r"\s+", " ", t).replace("{", "").replace("}", "").strip()
        out[key] = {
            "title": clean(title.group(1)) if title else None,
            "authors": clean(author.group(1)) if author else None,
            "arxiv": arx.group(1),
            "url": "https://arxiv.org/abs/" + arx.group(1),
        }
    return out


def _study(study_path):
    sys.path.insert(0, study_path)
    import claims  # noqa: E402
    import core  # noqa: E402
    import reference  # noqa: E402
    return claims, core, reference


def _corpus2(corpus2_dir):
    sys.path.insert(0, corpus2_dir)
    import corpus2  # noqa: E402
    return corpus2


def pooled_rate(c):
    """The mean of the two rates the paper printed, labelled as such."""
    return (c["candidate_rate"] + c["baseline_rate"]) / 2.0


def _tally(claims_mod, stated, n_not_stated, floor=None):
    """The study's own summary over the claims that have a count.

    `claims.summary` and `claims.summary_at_floor` iterate the module's
    CLAIMS, which the study loads from its own copy of v1. They are pointed at
    v2's stated claims for the call and restored after it, so the counting
    rule is the study's, unmodified.
    """
    saved = claims_mod.CLAIMS
    claims_mod.CLAIMS = tuple(stated)
    try:
        s = claims_mod.summary() if floor is None else claims_mod.summary_at_floor(floor)
    finally:
        claims_mod.CLAIMS = saved
    out = dict(s)
    out["count_not_stated"] = n_not_stated
    return out


def build(study_path, corpus2_dir=DEFAULT_CORPUS2, bib_path=DEFAULT_BIB):
    claims_mod, core, reference = _study(study_path)
    corpus2 = _corpus2(corpus2_dir)
    data = corpus2.load()
    entries = data["claims"]

    band_lo, band_med, band_hi = claims_mod.coefficient_band()
    sources = load_sources(bib_path)
    missing = sorted({c["citation_key"] for c in entries} - set(sources))
    if missing:
        raise SystemExit(
            "no resolvable source for: {}\n"
            "  Every published claim on the page must carry a link a reader "
            "can follow. Add the entry to {} before building.".format(
                ", ".join(missing), bib_path))

    rows, stated = [], []
    for c in entries:
        n = corpus2.stated_n(c)
        p = pooled_rate(c)
        row = {
            "citation_key": c["citation_key"],
            "paper": c["paper"],
            "claim": c["claim"],
            "candidate_display": c["candidate_display"],
            "baseline_display": c["baseline_display"],
            "printed_unit": c["printed_unit"],
            "candidate_printed": c["candidate_printed"],
            "baseline_printed": c["baseline_printed"],
            "delta_pp": c["delta_pp"],
            "n_episodes": n,
            "n_status": c["n_status"],
            "n_basis": c["n_basis"],
            "n_note": c.get("n_note"),
            "pooled_rate": p,
            "level": c["level"],
            "venue": derive_venue(c["claim"]),
            "checked": c["checked"],
            "source": dict(sources[c["citation_key"]],
                           page=c["source"]["page"], where=c["source"]["where"]),
        }
        if n is None:
            state = "count_not_stated"
            row.update({"sigma_star_pp": None, "band_lo_pp": None,
                        "band_hi_pp": None})
        else:
            cl = claims_mod.Claim(
                citation_key=c["citation_key"], paper=c["paper"],
                claim=c["claim"], delta_pp=c["delta_pp"], n_episodes=n,
                base_rate=p, level=c["level"], provenance="")
            stated.append(cl)
            state = claims_mod.classify(cl)
            s = core.sigma_star(delta=c["delta_pp"] / 100.0, n=n, p=p)
            row.update({
                # sigma-star: the smallest retraining SD that would erase the
                # reported gain. None when the gain fails on episode noise.
                "sigma_star_pp": None if s is None else round(s * 100.0, 4),
                "band_lo_pp": round(claims_mod._reference_sigma_pp(band_lo, p), 4),
                "band_hi_pp": round(claims_mod._reference_sigma_pp(band_hi, p), 4),
            })
        row.update({"state": state,
                    "state_label": STATE_COPY[state]["label"],
                    "state_line": STATE_COPY[state]["line"]})
        rows.append(row)

    n_not_stated = sum(1 for r in rows if r["state"] == "count_not_stated")

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

    with open(corpus2.CORPUS_PATH, "rb") as f:
        corpus_hash = hashlib.sha256(f.read()).hexdigest()

    return {
        "generated": datetime.date.today().isoformat(),
        "protocol_version": 1,
        "corpus_version": 2,
        "corpus_sha256": corpus_hash,
        "corpus_file": "source/audit_corpus_v2.json",
        "corpus_v1_file": "source/audit_corpus.json",
        "corrected": "2026-09-25",
        "corpus_note": data["_README"],
        "n_papers_screened": reference.N_SCREENED,
        "n_claims": len(rows),
        "summary": _tally(claims_mod, stated, n_not_stated),
        # The most forgiving floor a reader could ask for: at zero, nothing
        # can be erased by retraining noise at all.
        "summary_at_zero_floor": _tally(claims_mod, stated, n_not_stated, 0.0),
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
    ap.add_argument("--corpus2-dir", default=DEFAULT_CORPUS2)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--bib", default=DEFAULT_BIB)
    args = ap.parse_args()

    data = canonical(build(args.study, args.corpus2_dir, args.bib))
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")

    # The page reads the .js wrapper so it renders from a file:// URL as well
    # as over http. Both are written from the same object.
    js_out = os.path.splitext(args.out)[0] + ".js"
    with open(js_out, "w", encoding="utf-8") as f:
        f.write("// Generated by build/claims_export.py. Do not edit.\n")
        f.write("window.CLAIM_CHECK = ")
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write(";\n")

    s = data["summary"]
    print("wrote {} ({} claims, {} papers screened, corpus v{})".format(
        args.out, data["n_claims"], data["n_papers_screened"],
        data["corpus_version"]))
    print("  " + ", ".join("{}={}".format(k, v) for k, v in s.items()))


if __name__ == "__main__":
    main()
