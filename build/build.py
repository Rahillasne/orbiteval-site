"""Build the generated parts of orbiteval.com, and refuse to produce a
half-built site.

Three jobs, in order, any of which failing stops the build:

1. Locate the research source and FAIL LOUDLY if it is absent. The site's
   evidence pages are generated from modules that live on a branch in a
   separate worktree. If that worktree moves, the old pages keep serving
   old numbers with no warning, which is the exact failure the Claim Check
   page is about. So a missing source is an error, never a skip.

2. Run the exporters, then vendor the inputs they read into `source/` so
   the published site carries the corpus it claims to have checked, rather
   than only a hash of a file nobody can see.

3. Guard the overlap register mechanically. OVERLAP_REGISTER.md binds every
   task that reads panels.py: rejection rates and calibration may be
   published, retraining-noise magnitudes may not. A first version of the
   decision page published a per-run matrix and a spread column and was
   live before anyone noticed. A rule nobody checks is not a rule, so this
   step checks it.

Then it writes build-stamp.js, which every page loads to print the commit,
the corpus hash and the generation time in its footer.

Usage:
    python3 build/build.py [--study PATH]
    python3 build/build.py --check     # verify only, generate nothing
"""
import argparse
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys

allow_dirty = False
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
DEFAULT_STUDY = os.path.expanduser(
    "~/Orbit-Research-aistats/research/sensitivity_2026-09-19")

# Files the exporters read, vendored into the site so the published pages
# carry their own evidence. The per-episode panel files are deliberately
# NOT here: they are banked experimental records, they are the raw material
# of the restricted magnitude, and nothing on the site needs them.
VENDORED = ("audit_corpus.json", "reference_sources.json")

# Keys that would mean a retraining-noise magnitude had reached the site.
FORBIDDEN_KEYS = ("matrix", "per_run_a", "per_run_b", "per_seed",
                  "spread", "sigma", "sigma_retrain", "variance",
                  "variance_ratio", "seed_rates")


class BuildError(RuntimeError):
    pass


def require_study(study):
    """The research source, or a hard failure naming what is missing."""
    if not os.path.isdir(study):
        raise BuildError(
            "research source not found at {}\n"
            "  The evidence pages are generated from the sensitivity study, "
            "which lives on branch aistats2027-sensitivity.\n"
            "  Restore the worktree or pass --study PATH. The site is NOT "
            "rebuilt, and the published pages still show the previous "
            "numbers.".format(study))
    missing = [f for f in ("claims.py", "core.py", "reference.py",
                           "panels.py", "audit_corpus.json")
               if not os.path.exists(os.path.join(study, f))]
    if missing:
        raise BuildError(
            "research source at {} is incomplete: missing {}".format(
                study, ", ".join(missing)))
    return study


def walk(node, path=""):
    """Every (path, value) in a nested JSON structure."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, path + "/" + str(k))
    elif isinstance(node, list):
        yield path, node
        for i, v in enumerate(node):
            yield from walk(v, path + "[{}]".format(i))
    else:
        yield path, node


def guard_register(study):
    """Fail if a generated data file carries a retraining-noise magnitude.

    Two checks. The first is on key names, which catches the obvious case.
    The second is on shape: a bare list of numbers as long as the panel has
    runs is a per-seed vector whatever it is called, and a per-seed vector
    of rates IS the magnitude the register withholds.
    """
    problems = []
    for name in ("decision-data.json", "claims-data.json"):
        p = os.path.join(SITE, name)
        if not os.path.exists(p):
            continue
        with open(p) as f:
            data = json.load(f)
        n_runs = (data.get("panel") or {}).get("n_runs")
        for path, value in walk(data):
            leaf = path.rsplit("/", 1)[-1].split("[")[0]
            if leaf in FORBIDDEN_KEYS:
                problems.append("{}: key {!r} at {}".format(name, leaf, path))
            if (n_runs and isinstance(value, list) and len(value) == n_runs
                    and value and all(isinstance(v, (int, float))
                                      and not isinstance(v, bool)
                                      for v in value)):
                problems.append(
                    "{}: {} is a list of {} numbers, the shape of a per-seed "
                    "vector".format(name, path, n_runs))
    if problems:
        raise BuildError(
            "OVERLAP REGISTER VIOLATION -- refusing to publish.\n"
            "  {}\n"
            "  {}/OVERLAP_REGISTER.md permits rejection rates and "
            "calibration from these panels and forbids publishing a "
            "retraining-noise magnitude.".format(
                "\n  ".join(problems), study))


def run_exporter(script, study):
    r = subprocess.run(
        [sys.executable, os.path.join(HERE, script), "--study", study],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise BuildError("{} failed:\n{}{}".format(script, r.stdout, r.stderr))
    return r.stdout.strip()


def vendor(study):
    out = os.path.join(SITE, "source")
    os.makedirs(out, exist_ok=True)
    copied = []
    for name in VENDORED:
        src = os.path.join(study, name)
        if not os.path.exists(src):
            raise BuildError("cannot vendor {}: not found in {}".format(
                name, study))
        shutil.copy2(src, os.path.join(out, name))
        copied.append(name)
    return copied


def git(*args, strip=True):
    try:
        out = subprocess.run(["git", "-C", SITE, *args],
                             capture_output=True, text=True,
                             check=True).stdout
        return out.strip() if strip else out
    except Exception:
        return ""


GENERATED = ("claims-data.json", "claims-data.js", "decision-data.json",
             "decision-data.js", "build-stamp.js", "source/audit_corpus.json",
             "source/reference_sources.json")


def dirty_paths():
    """Uncommitted paths, excluding the files this build just wrote.

    The build necessarily runs before the commit that carries its output, so
    the generated files are always modified at this point. Counting them made
    every published page print "uncommitted", which reads as an unfinished
    product and was live for hours.
    """
    # NOT stripped: porcelain status codes are two columns plus a space, and
    # an unstaged modification leaves column one blank. Stripping the whole
    # output eats that leading space on the FIRST line only, which silently
    # removed one character from the first path and stopped it matching
    # GENERATED -- so the build called itself dirty forever.
    out = git("status", "--porcelain", strip=False)
    paths = []
    for line in out.split("\n"):
        if len(line) < 4:
            continue
        path = line[3:].strip().strip('"')
        # A rename reads "old -> new"; the new path is the one that matters.
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path not in GENERATED:
            paths.append(path)
    return paths


def stamp(study):
    corpus = os.path.join(study, "audit_corpus.json")
    with open(corpus, "rb") as f:
        corpus_hash = hashlib.sha256(f.read()).hexdigest()
    # The commit the build ran against. The stamp is written before the
    # commit that carries it, so this names the parent; `dirty` says whether
    # anything was uncommitted at build time, which is the honest caveat.
    commit = git("rev-parse", "--short", "HEAD")
    dirty = bool(dirty_paths())
    data = {
        "commit": commit or "unknown",
        "dirty": dirty,
        "corpus_sha256": corpus_hash,
        "generated": datetime.datetime.now(
            datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "study": os.path.basename(study.rstrip("/")),
    }
    with open(os.path.join(SITE, "build-stamp.js"), "w") as f:
        f.write("// Generated by build/build.py. Do not edit.\n")
        f.write("window.BUILD_STAMP = ")
        json.dump(data, f, indent=1)
        f.write(";\n")
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--study", default=DEFAULT_STUDY)
    ap.add_argument("--allow-dirty", action="store_true",
                    help="stamp and publish even though the tree has "
                         "uncommitted changes outside the generated files")
    ap.add_argument("--check", action="store_true",
                    help="verify the guard against existing data; generate "
                         "nothing")
    args = ap.parse_args()
    global allow_dirty
    allow_dirty = args.allow_dirty

    try:
        if args.check:
            guard_register(args.study)
            print("register guard: clean")
            return 0

        study = require_study(args.study)
        print("research source: {}".format(study))
        for script in ("claims_export.py", "decision_export.py"):
            print("  " + run_exporter(script, study).replace("\n", "\n  "))
        guard_register(study)
        print("register guard: clean")
        print("vendored: {}".format(", ".join(vendor(study))))
        s = stamp(study)
        print("stamp: {} corpus {}… {}".format(
            s["commit"], s["corpus_sha256"][:12], s["generated"]))
        if s["dirty"]:
            print("\nREFUSING TO PUBLISH A DIRTY BUILD", file=sys.stderr)
            print("  Uncommitted, besides the generated files:", file=sys.stderr)
            for path in dirty_paths():
                print("    " + path, file=sys.stderr)
            print("  Commit them, or pass --allow-dirty to stamp the site "
                  "as built from an uncommitted tree.", file=sys.stderr)
            if not allow_dirty:
                return 1
        return 0
    except BuildError as e:
        print("\nBUILD FAILED\n  {}".format(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
