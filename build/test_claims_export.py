"""Claim Check data on Corpus 2 v2.

    CLAIMS_CORPUS2=/private/tmp/orbit-engine-vnext/research/audit_corpus \
      python3 build/test_claims_export.py
"""
import hashlib
import json
import os
import sys
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import claims_export as E  # noqa: E402

STUDY = os.environ.get("CLAIMS_STUDY", E.DEFAULT_STUDY)
CORPUS2 = os.environ.get("CLAIMS_CORPUS2", E.DEFAULT_CORPUS2)
V1_SHA256 = "28d9452dd11498c1f209db6d0a12f2a1b11259c6020cda2a270059c99e25bf77"
NO_COUNT = [3, 4, 10, 11, 16, 17, 18, 19]


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class Export(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = E.build(STUDY, CORPUS2)
        cls.rows = cls.d["claims"]

    def test_tallies(self):
        self.assertEqual(self.d["summary"], {
            "negative_gain": 1, "fails_on_episode_noise": 7, "erased": 1,
            "inconclusive": 3, "survives": 0, "count_not_stated": 8})

    def test_tallies_at_a_zero_floor(self):
        self.assertEqual(self.d["summary_at_zero_floor"], {
            "negative_gain": 1, "fails_on_episode_noise": 7, "erased": 0,
            "inconclusive": 4, "survives": 0, "count_not_stated": 8})

    def test_a_claim_with_no_stated_count_is_listed_not_sized(self):
        got = [i for i, r in enumerate(self.rows) if r["state"] == "count_not_stated"]
        self.assertEqual(got, NO_COUNT)
        for i in NO_COUNT:
            r = self.rows[i]
            self.assertIsNone(r["n_episodes"], i)
            for k in ("sigma_star_pp", "band_lo_pp", "band_hi_pp"):
                self.assertIsNone(r[k], (i, k))
            self.assertEqual(r["state_label"], "Count not stated", i)

    def test_every_row_names_both_arms(self):
        self.assertEqual((self.rows[0]["candidate_display"], self.rows[0]["baseline_display"]),
                         ("IMLE-VLA (H=30)", "π0.5"))
        self.assertEqual(self.rows[2]["baseline_display"], "FAST")
        self.assertEqual(self.rows[1]["baseline_display"], "ActionCodec")
        for r in self.rows:
            self.assertTrue(r["candidate_display"] and r["baseline_display"])
            self.assertNotEqual(r["baseline_display"], "comparator")

    def test_no_unlabelled_base_rate(self):
        for r in self.rows:
            self.assertNotIn("base_rate", r)
            self.assertIn("pooled_rate", r)
            self.assertNotIn("provenance", r)
            self.assertTrue(r["n_basis"])

    def test_corpus_hash_is_v2(self):
        """Review Focus 2: the page says which file it was computed from."""
        self.assertEqual(self.d["corpus_version"], 2)
        self.assertEqual(self.d["corpus_sha256"],
                         sha(os.path.join(CORPUS2, "audit_corpus_v2.json")))

    def test_sigma_star_stays_the_only_sigma_key(self):
        keys = {k for r in self.rows for k in r}
        self.assertEqual({k for k in keys if "sigma" in k}, {"sigma_star_pp"})


class Published(unittest.TestCase):
    """The files the site serves. Run after a build."""

    def test_v1_is_still_published_byte_for_byte(self):
        """Review Focus 3: the old corpus keeps its address and its bytes."""
        self.assertEqual(sha(os.path.join(SITE, "source", "audit_corpus.json")), V1_SHA256)

    def test_v2_is_published_byte_for_byte(self):
        self.assertEqual(sha(os.path.join(SITE, "source", "audit_corpus_v2.json")),
                         sha(os.path.join(CORPUS2, "audit_corpus_v2.json")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
