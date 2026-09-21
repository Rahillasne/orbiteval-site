"""Export the Decision Card data file for orbiteval.com.

The card is built on the pi05_libero_object panel: eight retrainings of one
recipe on identical data, ten tasks, one hundred episodes each. Because
every run is the same recipe, the true difference between any two disjoint
arms is exactly zero, so every rejection either test makes is an error and
we know it is an error without having to argue about it.

Nothing on the card is invented. The arms are labelled A and B for the
page, but they are not two builds and the page says so: dressing them as a
vendor release would be the synthetic storytelling this page exists to
replace.

Usage:
    python3 build/decision_export.py [--study PATH] [--out PATH]
"""
import argparse
import itertools
import json
import math
import os
import sys

DEFAULT_STUDY = os.path.expanduser(
    "~/Orbit-Research-aistats/research/sensitivity_2026-09-19")
DEFAULT_OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "decision-data.json")

Z = 1.959964
ARM_SIZE = 2  # retrains per arm; the smallest number anyone actually runs


def build(study_path):
    sys.path.insert(0, study_path)
    from core import t_crit, two_prop_z, welch_t  # noqa: E402
    from panels import PANELS, load_panel  # noqa: E402

    panel_name = "pi05_libero_object"
    spec = PANELS[panel_name]
    p = load_panel(panel_name)
    runs = sorted(p)
    n_tasks = spec.n_tasks

    # The full per-run, per-task matrix. This is the evidence; everything
    # else on the card is a reading of it.
    matrix = []
    for t in range(n_tasks):
        cells = []
        for r in runs:
            ep = p[r][t]
            cells.append({"run": r, "successes": sum(ep), "n": len(ep)})
        rates = [c["successes"] / c["n"] * 100.0 for c in cells]
        matrix.append({
            "task": t,
            "cells": cells,
            "min": min(rates),
            "max": max(rates),
            "spread": max(rates) - min(rates),
        })

    # Every disjoint arm pair, every task. Classify what each test did.
    # `both` is tracked to check the claim that the retrain-level test's
    # rejections are a subset of the episode-level test's, rather than
    # asserting it.
    cases, n_cells = [], 0
    n_ep, n_rt, n_both, n_ep_only = 0, 0, 0, 0
    for A in itertools.combinations(runs, ARM_SIZE):
        rest = [r for r in runs if r not in A]
        for B in itertools.combinations(rest, ARM_SIZE):
            if min(A) >= min(B):
                continue
            for t in range(n_tasks):
                n_cells += 1
                xa = sum(sum(p[r][t]) for r in A)
                na = sum(len(p[r][t]) for r in A)
                xb = sum(sum(p[r][t]) for r in B)
                nb = sum(len(p[r][t]) for r in B)
                z = two_prop_z(xa, na, xb, nb)
                ra = [sum(p[r][t]) / len(p[r][t]) for r in A]
                rb = [sum(p[r][t]) / len(p[r][t]) for r in B]
                tt, df = welch_t(ra, rb)
                ep_rej = abs(z) > Z
                rt_rej = abs(tt) > t_crit(df)
                n_ep += ep_rej
                n_rt += rt_rej
                n_both += (ep_rej and rt_rej)
                n_ep_only += (ep_rej and not rt_rej)
                if ep_rej and not rt_rej:
                    cases.append({
                        "task": t, "arm_a": list(A), "arm_b": list(B),
                        "x_a": xa, "n_a": na, "x_b": xb, "n_b": nb,
                        "rate_a": xa / na * 100.0, "rate_b": xb / nb * 100.0,
                        "gap_pp": abs(xa / na - xb / nb) * 100.0,
                        "z": z, "welch_t": tt, "df": df,
                        "t_crit": t_crit(df),
                        # Two-sided normal p for the pooled-episode z. At
                        # |z| this large the value underflows any sensible
                        # printed precision, so the page states a bound.
                        "p_two_sided": math.erfc(abs(z) / math.sqrt(2.0)),
                        "per_run_a": [r * 100.0 for r in ra],
                        "per_run_b": [r * 100.0 for r in rb],
                    })

    cases.sort(key=lambda c: -c["gap_pp"])
    headline = cases[0]

    return {
        "generated": __import__("datetime").date.today().isoformat(),
        "panel": {
            "name": panel_name,
            "policy_class": spec.policy_class,
            "suite": spec.suite,
            "n_runs": len(runs),
            "runs": runs,
            "n_tasks": n_tasks,
            "episodes_per_cell": len(p[runs[0]][0]),
            "total_episodes": sum(
                len(p[r][t]) for r in runs for t in range(n_tasks)),
            "venue": "simulation_benchmark",
            "note": "Eight retrainings of one recipe on identical data. "
                    "The true difference between any two arms is zero.",
        },
        "arm_size": ARM_SIZE,
        "counts": {
            "n_cells": n_cells,
            "episode_level_rejects": n_ep,
            "retrain_level_rejects": n_rt,
            "both_reject": n_both,
            "episode_only_rejects": n_ep_only,
            "retrain_rejects_are_subset": n_both == n_rt,
        },
        "headline": headline,
        "matrix": matrix,
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
    js_out = os.path.splitext(args.out)[0] + ".js"
    with open(js_out, "w") as f:
        f.write("// Generated by build/decision_export.py. Do not edit.\n")
        f.write("window.DECISION_CARD = ")
        json.dump(data, f, indent=1)
        f.write(";\n")

    c, h = data["counts"], data["headline"]
    print("wrote {}".format(args.out))
    print("  {} cells, episode-level rejects {}, retrain-level {}, "
          "episode-only {}".format(
              c["n_cells"], c["episode_level_rejects"],
              c["retrain_level_rejects"], c["episode_only_rejects"]))
    print("  retrain rejections are a subset of episode rejections: {}".format(
        c["retrain_rejects_are_subset"]))
    print("  headline: task {} {:.1f}% vs {:.1f}% ({:.1f} pp, z={:.2f})".format(
        h["task"], h["rate_a"], h["rate_b"], h["gap_pp"], h["z"]))


if __name__ == "__main__":
    main()
