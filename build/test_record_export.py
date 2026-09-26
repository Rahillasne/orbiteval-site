"""The record page's data on Corpus 2 v2 and engine v0.2. Run after a build.

    python3 build/test_record_export.py
"""
import json
import os
import unittest

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_COUNT = [3, 4, 10, 11, 16, 17, 18, 19]


class RecordData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(SITE, "release-record-data.json"), encoding="utf-8") as f:
            cls.d = json.load(f)
        cls.rows = cls.d["corpus2"]

    def test_engine_and_counts(self):
        self.assertEqual(self.d["engine"], "Release Record v0.2")
        c = self.d["counts"]
        self.assertEqual((c["corpus2_records"], c["corpus2_below_limit"],
                          c["corpus2_no_count"]), (20, 8, 8))

    def test_a_record_with_no_stated_count_has_no_detection_limit(self):
        """Review Focus 1, and the rule for unknown counts."""
        for i in NO_COUNT:
            r = self.rows[i]
            self.assertIsNone(r["mde_pp"], i)
            self.assertIsNone(r["below_detection_limit"], i)
            self.assertEqual(r["mde_basis"], "not computed", i)
            self.assertIn("(detection limit not computed)", r["rendered"], i)
            self.assertNotIn("pre-specified", r["rendered"], i)

    def test_records_name_both_arms(self):
        self.assertEqual((self.rows[0]["baseline_label"], self.rows[0]["candidate_label"]),
                         ("π0.5", "IMLE-VLA (H=30)"))
        for r in self.rows:
            self.assertNotEqual(r["baseline_label"], "comparator")

    def test_the_nhtsa_figures_carry_their_plain_reading(self):
        """A named operator's share of reported incidents is not a per-mile rate."""
        self.assertEqual(
            self.d["sources"]["nhtsa"]["reading"],
            "This is a share of reported incidents, not a rate per mile. "
            "Without mileage it cannot say whether Version 11 is safer or less "
            "safe, and five version labels still need adjudication.")

    def test_one_identity_value_for_every_corpus2_record(self):
        self.assertEqual({r["identity"] for r in self.rows}, {"unknown"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
