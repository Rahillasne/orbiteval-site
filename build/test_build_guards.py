"""Tests for the guards that stand between this repository and the public site.

Two of them exist because something already went wrong. A per-run matrix and a
spread column were published and live before anyone noticed, and a
retraining-noise magnitude sat in a vendored public corpus for days because the
register matched exact names and nobody had thought of that one.

The third is here so the single exemption stays single. `sigma_star_pp` is
allowed in one file, under one path, for one reason. A test is the only thing
that stops "allowed in the Claim Check output" drifting into "allowed", which
is how a check becomes a decoration.

    python3 build/test_build_guards.py
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B                                   # noqa: E402
from canonical import canonical, is_canonical       # noqa: E402

SITE = B.SITE
CLAIMS = "claims-data.json"
RECORD = "release-record-data.json"
DECISION = "decision-data.json"


def paths(name):
    """Every (path, value) in a generated file on disk."""
    with open(os.path.join(SITE, name)) as f:
        return list(B.walk(json.load(f)))


class ExemptionIsExact(unittest.TestCase):
    """The exemption is one field, in one file, at one path. Nothing else."""

    def test_there_is_exactly_one_exemption(self):
        self.assertEqual(len(B.EXEMPTIONS), 1)
        e = B.EXEMPTIONS[0]
        self.assertEqual(e["file"], CLAIMS)
        self.assertEqual(e["field"], "sigma_star_pp")

    def test_exemption_documents_its_reason(self):
        why = B.EXEMPTIONS[0]["why"]
        # It is a derived planning threshold from public external data, and
        # the reason has to say so rather than merely asserting it is fine.
        self.assertIn("planning threshold", why)
        self.assertIn("PUBLIC EXTERNAL", why)

    def test_allowed_at_the_claim_check_path(self):
        self.assertIsNone(
            B.forbidden_key("sigma_star_pp", CLAIMS, "/claims[0]/sigma_star_pp"))
        self.assertIsNone(
            B.forbidden_key("sigma_star_pp", CLAIMS, "/claims[19]/sigma_star_pp"))

    def test_forbidden_in_release_record_output(self):
        """The whole point: the exemption must not reach a Release Record."""
        self.assertIsNotNone(
            B.forbidden_key("sigma_star_pp", RECORD, "/claims[0]/sigma_star_pp"))
        self.assertIsNotNone(
            B.forbidden_key("sigma_star_pp", RECORD, "/nhtsa/sigma_star_pp"))

    def test_forbidden_in_any_future_evidence_record(self):
        for name in ("packet-data.json", "intake-data.json", "evidence.json",
                     DECISION):
            self.assertIsNotNone(
                B.forbidden_key("sigma_star_pp", name,
                                "/claims[0]/sigma_star_pp"),
                "{} must not inherit the exemption".format(name))

    def test_forbidden_elsewhere_in_the_same_file(self):
        """Right file, wrong path, still forbidden."""
        for path in ("/sigma_star_pp", "/summary/sigma_star_pp",
                     "/band/sigma_star_pp", "/claims/sigma_star_pp",
                     "/claims[0]/nested/sigma_star_pp",
                     "/claims[0]/sigma_star_pp/inner"):
            self.assertIsNotNone(
                B.forbidden_key("sigma_star_pp", CLAIMS, path),
                "{} must not be exempt".format(path))

    def test_forbidden_in_public_source(self):
        for name in B.PUBLIC_SOURCE:
            self.assertIsNotNone(
                B.forbidden_key("sigma_star_pp", name,
                                "/claims[0]/sigma_star_pp"))

    def test_no_other_sigma_name_is_exempt(self):
        for leaf in ("sigma", "sigma_pp", "sigma_retrain", "sigma_star",
                     "external_median_sigma_pp", "retrain_sigma_pp",
                     "SIGMA_STAR_PP", "sigma_star_pp_2"):
            self.assertIsNotNone(
                B.forbidden_key(leaf, CLAIMS, "/claims[0]/" + leaf),
                "{} must not be exempt".format(leaf))

    def test_redaction_never_consults_the_exemption(self):
        """redact() strips before publication, so it takes no path and keeps
        nothing. A field is exempt somewhere specific or nowhere."""
        removed = []
        out = B.redact({"claims": [{"sigma_star_pp": 1.0, "keep": 2}]}, removed)
        self.assertEqual(out, {"claims": [{"keep": 2}]})
        self.assertEqual(removed, ["/claims[0]/sigma_star_pp"])


class ReleaseRecordOutputIsClean(unittest.TestCase):
    """The real generated file, not a constructed one."""

    def test_no_sigma_field_anywhere_in_release_record_data(self):
        bad = [p for p, _ in paths(RECORD)
               if any(t in p.rsplit("/", 1)[-1].split("[")[0].lower()
                      for t in B.FORBIDDEN_TOKENS)]
        self.assertEqual(bad, [])

    def test_nhtsa_record_carries_no_forbidden_field(self):
        with open(os.path.join(SITE, RECORD)) as f:
            nhtsa = json.load(f)["nhtsa"]
        for leaf in nhtsa:
            self.assertIsNone(B.forbidden_key(leaf, RECORD, "/nhtsa/" + leaf))

    def test_no_sigma_string_in_the_serialised_file(self):
        with open(os.path.join(SITE, RECORD)) as f:
            self.assertNotIn("sigma", f.read().lower())

    def test_claims_file_carries_the_exemption_only_where_declared(self):
        found = [p for p, _ in paths(CLAIMS)
                 if "sigma" in p.rsplit("/", 1)[-1].lower()]
        self.assertEqual(len(found), 20)
        for p in found:
            self.assertIsNone(B.forbidden_key("sigma_star_pp", CLAIMS, p))


class RegisterGuardCatchesPlantedViolations(unittest.TestCase):

    def test_token_match_catches_an_unforeseen_name(self):
        # The exact-name list missed this one, which is why tokens exist.
        self.assertIsNotNone(
            B.forbidden_key("external_median_sigma_pp", "source/x.json", "/x"))

    def test_counts_and_labels_are_not_magnitudes(self):
        for leaf in ("n_seeds", "seed_axis", "n_episodes", "n_runs"):
            self.assertIsNone(B.forbidden_key(leaf, CLAIMS, "/" + leaf))


class CanonicalFloats(unittest.TestCase):

    def test_the_float_that_differed_between_interpreters_is_rejected(self):
        # 3.11 produced this; 3.12 and 3.14 produced ...873.
        self.assertFalse(is_canonical(0.019409683130415877))
        self.assertTrue(is_canonical(canonical(0.019409683130415877)))

    def test_every_generated_float_is_canonical(self):
        for name in (CLAIMS, DECISION, RECORD):
            for path, value in paths(name):
                self.assertTrue(is_canonical(value),
                                "{} {} = {!r}".format(name, path, value))

    def test_bools_and_ints_pass_through(self):
        self.assertIs(canonical(True), True)
        self.assertIs(canonical(False), False)
        self.assertEqual(canonical(2000), 2000)
        self.assertIsInstance(canonical(2000), int)


class StampIsDeterministic(unittest.TestCase):

    def test_stamp_carries_no_wall_clock(self):
        with open(os.path.join(SITE, "build-stamp.js")) as f:
            body = f.read().split("=", 1)[1].rsplit(";", 1)[0]
        stamp = json.loads(body)
        self.assertNotIn("generated", stamp)
        # The site's own HEAD cannot appear: the stamp is committed into the
        # commit it would name, so a clean rebuild could never reproduce it.
        self.assertNotIn("commit", stamp)
        self.assertEqual(
            set(stamp), {"source_commit", "source_date", "dirty",
                         "corpus_sha256", "artifact_sha256", "study",
                         "study_corpus_sha256", "corpus2_source_commit"})

    def test_artifact_hash_matches_the_files_on_disk(self):
        with open(os.path.join(SITE, "build-stamp.js")) as f:
            body = f.read().split("=", 1)[1].rsplit(";", 1)[0]
        self.assertEqual(json.loads(body)["artifact_sha256"],
                         B.artifact_sha256())


if __name__ == "__main__":
    unittest.main(verbosity=2)
