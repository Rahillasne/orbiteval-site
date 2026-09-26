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
   than only a hash of a file nobody can see. Vendoring strips anything on
   the register on the way through and says so in the file.

3. Guard the overlap register mechanically. OVERLAP_REGISTER.md binds every
   task that reads panels.py: rejection rates and calibration may be
   published, retraining-noise magnitudes may not. A first version of the
   decision page published a per-run matrix and a spread column and was
   live before anyone noticed. A rule nobody checks is not a rule, so this
   step checks it, over the generated data AND the vendored source, and
   then runs build/test_redaction.py.

Then it writes build-stamp.js, which every page loads to print the commit,
the corpus hash and the generation time in its footer.

Usage:
    python3 build/build.py [--study PATH] [--corpus2-dir PATH]
    python3 build/build.py --check     # verify only, generate nothing
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from canonical import is_canonical  # noqa: E402  (needs the path above)

allow_dirty = False
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
DEFAULT_STUDY = os.path.expanduser(
    "~/Orbit-Research-aistats/research/sensitivity_2026-09-19")
DEFAULT_CORPUS2 = os.path.expanduser("~/Orbit-Research/research/audit_corpus")
CORPUS2_V2 = "audit_corpus_v2.json"

# Files the exporters read, vendored into the site so the published pages
# carry their own evidence. The per-episode panel files are deliberately
# NOT here: they are banked experimental records, they are the raw material
# of the restricted magnitude, and nothing on the site needs them.
VENDORED = ("audit_corpus.json", "reference_sources.json")

# Keys that would mean a retraining-noise magnitude had reached the site.
FORBIDDEN_KEYS = ("matrix", "per_run_a", "per_run_b", "per_seed",
                  "spread", "sigma", "sigma_retrain", "variance",
                  "variance_ratio", "seed_rates")

# Substrings that make a key forbidden whatever it is called around them.
# The exact list above missed `external_median_sigma_pp`, which sat in a
# PUBLIC vendored source file for days because no name in it matched exactly.
# A register that only catches the names someone already thought of is not a
# register. `n_seeds` and `seed_axis` are counts and labels, not magnitudes,
# and deliberately do not match any token here.
FORBIDDEN_TOKENS = ("sigma", "variance", "spread", "per_seed", "seed_rates",
                    "per_run", "matrix")

# The ONE exemption, pinned to a single field in a single file at a single
# path. Not a class of names, not a file-wide pass, and not a rule that any
# future evidence record inherits.
#
# A broad "sigma is sometimes fine" exception would be worse than no token
# rule at all, because it would read as a check while letting the next
# magnitude through under a plausible name. So an exemption has to name the
# file, match the exact JSON path, and carry its reason. Anything that does
# not match all three is forbidden, including this same field name in
# release-record-data.json, in the NHTSA output, in the public source
# corpora, or anywhere else in claims-data.json.
EXEMPTIONS = (
    {
        "file": "claims-data.json",
        "path": re.compile(r"^/claims\[\d+\]/sigma_star_pp$"),
        "field": "sigma_star_pp",
        "why": ("A derived planning threshold computed from PUBLIC EXTERNAL "
                "data, not a measurement of our retraining noise. "
                "core.sigma_star(delta, n, p) returns the smallest retrain SD "
                "that would erase an external claim, from that claim's own "
                "published gain, episode count and base rate. It is the "
                "withheld quantity inverted: a requirement read off someone "
                "else's table. claims.py and reference.py import neither "
                "panels.py nor anything derived from it, so the register "
                "clause does not reach them. Scope is the existing Claim "
                "Check output and nothing else."),
    },
)

# Public artifacts that are not generated but ARE published: the corpora the
# evidence pages claim to have checked. They are vendored from the research
# source, so a magnitude added upstream reaches the site unless it is stripped
# on the way through.
PUBLIC_SOURCE = ("source/audit_corpus.json", "source/reference_sources.json",
                 "source/audit_corpus_v2.json")


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


def exempt(name, leaf, path):
    """True only for an exemption matching this file, field AND exact path."""
    for e in EXEMPTIONS:
        if e["file"] == name and e["field"] == leaf and e["path"].match(path):
            return True
    return False


def forbidden_key(leaf, name=None, path=None):
    """Why this key name is forbidden here, or None if it is allowed.

    `name` and `path` locate the key. Omit them -- as redact() does, since it
    strips before anything is published -- and no exemption can apply, which
    is the safe direction: a field is exempt somewhere specific or nowhere.
    """
    if name is not None and path is not None and exempt(name, leaf, path):
        return None
    low = leaf.lower()
    if leaf in FORBIDDEN_KEYS:
        return "name {!r} is on the register".format(leaf)
    for tok in FORBIDDEN_TOKENS:
        if tok in low:
            return "name {!r} contains {!r}".format(leaf, tok)
    return None


def redact(node, removed, path=""):
    """A copy of `node` with every forbidden key dropped, recording what went.

    Vendoring copied the research corpus verbatim, which is how a
    retraining-noise magnitude reached a public file. Stripping it here means
    the published corpus can never carry one even if the research file grows a
    new one tomorrow. What was removed is recorded in the file itself: a
    silent redaction is indistinguishable from a file that never had the
    field, and the next person to compare the two copies deserves to know.
    """
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if forbidden_key(k):
                removed.append(path + "/" + k)
                continue
            out[k] = redact(v, removed, path + "/" + k)
        return out
    if isinstance(node, list):
        return [redact(v, removed, path + "[{}]".format(i))
                for i, v in enumerate(node)]
    return node


def guard_register(study):
    """Fail if a generated data file carries a retraining-noise magnitude.

    Two checks. The first is on key names, which catches the obvious case.
    The second is on shape: a bare list of numbers as long as the panel has
    runs is a per-seed vector whatever it is called, and a per-seed vector
    of rates IS the magnitude the register withholds.
    """
    problems = []
    checked = ("decision-data.json", "claims-data.json",
               "release-record-data.json") + PUBLIC_SOURCE
    for name in checked:
        p = os.path.join(SITE, name)
        if not os.path.exists(p):
            continue
        with open(p) as f:
            data = json.load(f)
        n_runs = (data.get("panel") or {}).get("n_runs")
        for path, value in walk(data):
            leaf = path.rsplit("/", 1)[-1].split("[")[0]
            why = forbidden_key(leaf, name, path)
            if why:
                problems.append("{}: {} at {}".format(name, why, path))
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


def guard_canonical():
    """Fail if a generated file carries a float at more than canonical precision.

    Two interpreters disagreed about the last bit of `coef_min`: CPython 3.12
    changed `sum()` to compensated summation, so the same inputs gave a
    different final digit than 3.11. Each interpreter was internally
    deterministic, which is what made it hard to see. Exporters now round at
    the publication boundary; this check is what stops the next exporter from
    forgetting to.
    """
    problems = []
    for name in ("decision-data.json", "claims-data.json",
                 "release-record-data.json"):
        p = os.path.join(SITE, name)
        if not os.path.exists(p):
            continue
        with open(p) as f:
            data = json.load(f)
        for path, value in walk(data):
            if not is_canonical(value):
                problems.append("{}: {} = {!r}".format(name, path, value))
    if problems:
        raise BuildError(
            "NON-CANONICAL FLOAT -- refusing to publish.\n"
            "  {}\n"
            "  These carry more precision than the computation has, and they "
            "differ between CPython versions. The exporter that wrote them "
            "must pass its data through canonical().".format(
                "\n  ".join(problems[:10])))


def run_guard_tests():
    """Run the guard tests as part of the build.

    The register and the exemption are only worth what checks them, and a
    test suite that has to be remembered is one that stops being run. This
    puts them in the path of every build instead.
    """
    r = subprocess.run(
        [sys.executable, os.path.join(HERE, "test_build_guards.py")],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise BuildError("guard tests FAILED:\n{}{}".format(r.stdout, r.stderr))
    last = [ln for ln in (r.stdout + r.stderr).strip().split("\n") if ln.strip()]
    return last[-2] if len(last) > 1 else "guard tests passed"


def run_redaction_tests():
    """Run build/test_redaction.py as part of every build.

    The retraining-noise field was removed from the public corpus by hand on
    2026-09-25, and the next build would have copied it straight back. A test
    that has to be remembered is one that stops being run, so the build runs
    it and refuses to finish if it fails.
    """
    r = subprocess.run(
        [sys.executable, os.path.join(HERE, "test_redaction.py")],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise BuildError(
            "redaction tests FAILED:\n{}{}".format(r.stdout, r.stderr))
    last = [ln for ln in (r.stdout + r.stderr).strip().split("\n") if ln.strip()]
    return last[-2] if len(last) > 1 else "redaction tests passed"


def run_exporter(script, study, *extra):
    r = subprocess.run(
        [sys.executable, os.path.join(HERE, script), "--study", study, *extra],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise BuildError("{} failed:\n{}{}".format(script, r.stdout, r.stderr))
    return r.stdout.strip()


def run_record_exporter(corpus2_dir):
    """Generate the Release Record page data from the engine and Corpus 2 v2
    in the same Orbit-Research checkout as corpus2_dir."""
    orbit = os.path.dirname(os.path.dirname(os.path.abspath(corpus2_dir)))
    r = subprocess.run(
        [sys.executable, os.path.join(HERE, "release_record_export.py"),
         "--engine", os.path.join(orbit, "product", "release_record"),
         "--corpus2-dir", corpus2_dir],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise BuildError("release_record_export.py failed:\n{}{}".format(
            r.stdout, r.stderr))
    return r.stdout.strip()


def require_corpus2(corpus2_dir):
    """Corpus 2 v2 and its reader, or a hard failure naming what is missing.

    The Claim Check is computed from Corpus 2 v2, which lives in Orbit-Research
    beside the one module allowed to read it. A missing checkout stops the
    build for the same reason a missing study does: the old page would keep
    serving old numbers.
    """
    missing = [f for f in ("corpus2.py", CORPUS2_V2)
               if not os.path.exists(os.path.join(corpus2_dir, f))]
    if missing:
        raise BuildError(
            "Corpus 2 v2 not found at {}: missing {}\n"
            "  Pass --corpus2-dir PATH, the research/audit_corpus directory of "
            "an Orbit-Research checkout.".format(corpus2_dir, ", ".join(missing)))
    return corpus2_dir


def vendor_v2(corpus2_dir):
    """Publish Corpus 2 v2 beside v1, byte for byte.

    v1 keeps its own name and bytes, because readers already link to it. v2 is
    its own file. Its research copy is meant to carry no register key at all,
    but `test_corpus2.py` only checks that no key contains "sigma", so this
    function checks the full register token list itself and refuses rather
    than strips if it finds one. Once that check passes, the file is copied
    byte for byte, not re-serialised.
    """
    with open(os.path.join(corpus2_dir, CORPUS2_V2), encoding="utf-8") as f:
        data = json.load(f)
    removed = []
    redact(data, removed)
    if removed:
        raise BuildError("Corpus 2 v2 carries register keys: {}".format(
            ", ".join(removed)))
    shutil.copyfile(os.path.join(corpus2_dir, CORPUS2_V2),
                    os.path.join(SITE, "source", CORPUS2_V2))
    return CORPUS2_V2


def file_sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def vendor(study):
    """Copy the corpora the site publishes, stripping anything on the register.

    The research originals are left untouched; only the public copy is
    redacted, and it says so on its face.
    """
    out = os.path.join(SITE, "source")
    os.makedirs(out, exist_ok=True)
    copied, stripped = [], []
    for name in VENDORED:
        src = os.path.join(study, name)
        if not os.path.exists(src):
            raise BuildError("cannot vendor {}: not found in {}".format(
                name, study))
        with open(src) as f:
            data = json.load(f)
        removed = []
        data = redact(data, removed)
        if removed:
            data["_redacted"] = {
                "fields": sorted(removed),
                "why": ("Withheld under OVERLAP_REGISTER.md: these are "
                        "retraining-noise magnitudes, which belong to a "
                        "sibling submission under review. Everything the "
                        "published pages compute from this corpus is present. "
                        "The unredacted file is in the research repository."),
            }
            stripped += ["{}{}".format(name, r) for r in removed]
        with open(os.path.join(out, name), "w") as f:
            json.dump(data, f, indent=1)
            f.write("\n")
        copied.append(name)
    return copied, stripped


def git_at(repo, *args):
    """git in another repository, for recording where the inputs came from."""
    try:
        return subprocess.run(["git", "-C", repo, *args], capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:
        return ""


def git(*args, strip=True):
    try:
        out = subprocess.run(["git", "-C", SITE, *args],
                             capture_output=True, text=True,
                             check=True).stdout
        return out.strip() if strip else out
    except Exception:
        return ""


# The generated data the pages read. Hashed into the stamp as one number.
GENERATED_DATA = ("claims-data.json", "decision-data.json",
                  "release-record-data.json", "source/audit_corpus.json",
                  "source/reference_sources.json", "source/audit_corpus_v2.json")

GENERATED = ("claims-data.json", "claims-data.js", "decision-data.json",
             "decision-data.js", "release-record-data.json",
             "release-record-data.js", "build-stamp.js",
             "source/audit_corpus.json", "source/reference_sources.json",
             "source/audit_corpus_v2.json")


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


def artifact_sha256():
    """One hash over every generated data file, in a fixed order.

    This is the "same inputs produced the same artifact" number. It covers
    what the pages actually read, so a change to any published figure moves
    it, and it is computed before the stamp is written so the stamp can never
    hash itself.
    """
    h = hashlib.sha256()
    for name in sorted(GENERATED_DATA):
        path = os.path.join(SITE, name)
        if not os.path.exists(path):
            continue
        h.update(name.encode())
        with open(path, "rb") as f:
            h.update(f.read())
    return h.hexdigest()


def stamp(study, corpus2_dir):
    """Provenance for the footer: inputs and outputs, no wall clock.

    The stamp used to record the moment the build ran, so two people building
    one commit from one set of inputs produced different bytes. That quietly
    contradicts the sentence the whole site rests on.

    It also used to name the SITE's own HEAD, which cannot work: the stamp is
    committed into the very commit it would have to name, so a clean rebuild
    of that commit always disagrees with the file inside it. The commit
    recorded here is therefore the SOURCE commit -- the research worktree the
    numbers came from -- which is an input to the build rather than its
    container, and is stable however often the site is committed. The site's
    own commit is in git already and does not need restating.

    `corpus_sha256` is Corpus 2 v2, the file the Claim Check and the Release
    Record are computed from; every page's footer prints it, so it must name
    the same corpus the page body shows. `study_corpus_sha256` is the
    sensitivity study's own copy of the corpus, which its code still loads
    and which `corpus_sha256` named before Corpus 2 v2 existed.
    `corpus2_source_commit` names the Orbit-Research checkout `corpus2_dir`
    came from, the same way `source_commit` names the study's.

    Everything left is a fact about inputs or outputs: which research commit,
    its date, the input corpus hashes, and one hash over everything generated.
    The footer still warns when the site is going stale, measuring the age of
    the SOURCE rather than the last time somebody happened to run a build.
    """
    corpus_hash = file_sha256(os.path.join(corpus2_dir, CORPUS2_V2))
    study_corpus = os.path.join(study, "audit_corpus.json")
    with open(study_corpus, "rb") as f:
        study_corpus_hash = hashlib.sha256(f.read()).hexdigest()
    # The commit the build ran against. The stamp is written before the
    # commit that carries it, so this names the parent; `dirty` says whether
    # anything was uncommitted at build time, which is the honest caveat.
    source_commit = git_at(study, "rev-parse", "--short", "HEAD")
    source_date = git_at(study, "show", "-s", "--format=%cI", "HEAD")
    dirty = bool(dirty_paths())
    data = {
        "source_commit": source_commit or "unknown",
        "source_date": source_date or "unknown",
        "dirty": dirty,
        "corpus_sha256": corpus_hash,
        "study_corpus_sha256": study_corpus_hash,
        "corpus2_source_commit": git_at(corpus2_dir, "rev-parse", "--short",
                                        "HEAD") or "unknown",
        "artifact_sha256": artifact_sha256(),
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
    ap.add_argument("--corpus2-dir", default=DEFAULT_CORPUS2)
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
            guard_canonical()
            print("canonical guard: clean")
            print("guard tests: {}".format(run_guard_tests()))
            print("redaction tests: {}".format(run_redaction_tests()))
            return 0

        study = require_study(args.study)
        corpus2_dir = require_corpus2(args.corpus2_dir)
        print("corpus 2 v2: {}".format(corpus2_dir))
        print("research source: {}".format(study))
        print("  " + run_exporter("claims_export.py", study, "--corpus2-dir",
                                  corpus2_dir).replace("\n", "\n  "))
        print("  " + run_exporter("decision_export.py", study).replace(
            "\n", "\n  "))
        # The Release Record exporter reads the engine and Corpus 2 v2, not
        # the study, so it takes no --study and fails on its own terms if
        # either is absent.
        print("  " + run_record_exporter(corpus2_dir).replace("\n", "\n  "))
        # Vendor BEFORE guarding. The register now covers the public source
        # copies as well as the generated files, and those copies are written
        # by this step; guarding first would check the previous build's files
        # and pass on a corpus that no longer exists.
        copied, stripped = vendor(study)
        print("vendored: {}".format(", ".join(copied)))
        for r in stripped:
            print("  REDACTED {} (overlap register)".format(r))
        print("vendored: {}".format(vendor_v2(corpus2_dir)))
        guard_register(study)
        print("register guard: clean")
        guard_canonical()
        print("canonical guard: clean")
        s = stamp(study, corpus2_dir)
        # After the stamp: the tests check the stamp's own shape and hash.
        print("guard tests: {}".format(run_guard_tests()))
        print("redaction tests: {}".format(run_redaction_tests()))
        print("stamp: source {} corpus {}… artifact {}…".format(
            s["source_commit"], s["corpus_sha256"][:12],
            s["artifact_sha256"][:12]))
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
