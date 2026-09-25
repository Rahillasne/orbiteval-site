"""The retraining-noise field cannot come back to the public site.

`external_median_sigma_pp` reached the published corpus because vendoring
copied the research file verbatim, and the register guard matched exact key
names in the generated data only. It was removed from the public copy by hand
on 2026-09-25, and the next build would have copied it straight back while the
guard reported "clean". These tests hold the three things that now stop it:
the build strips the field on the way in, the guard refuses it in any public
file, and the copy on disk does not carry it.

The planted value is a sentinel. The withheld magnitude never appears here.

    python3 build/test_redaction.py
"""
import inspect
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True      # importing build must not touch the tree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B                   # noqa: E402

FIELD = "external_median_sigma_pp"
SENTINEL = 123.456
REAL_SITE = B.SITE


def research_corpus(**extra):
    data = {"claims": [{"paper": "P", "claim": "c", "delta_pp": 1.0,
                        "n_episodes": 2000, "base_rate": 0.9}]}
    data.update(extra)
    return data


class Sandbox(unittest.TestCase):
    """A throwaway study and site, so no test writes to the real tree."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.study = os.path.join(self.tmp, "study")
        self.site = os.path.join(self.tmp, "site")
        os.makedirs(self.study)
        os.makedirs(os.path.join(self.site, "source"))
        self.saved_site, B.SITE = B.SITE, self.site

    def tearDown(self):
        B.SITE = self.saved_site
        shutil.rmtree(self.tmp)

    def write_study(self, audit, reference=None):
        for name, data in (("audit_corpus.json", audit),
                           ("reference_sources.json", reference or {"refs": []})):
            with open(os.path.join(self.study, name), "w") as f:
                json.dump(data, f)

    def published(self, name="audit_corpus.json"):
        with open(os.path.join(self.site, "source", name)) as f:
            return f.read()


class VendoringStripsTheField(Sandbox):

    def test_the_field_is_not_in_the_published_copy(self):
        self.write_study(research_corpus(**{FIELD: SENTINEL}))
        copied, stripped = B.vendor(self.study)
        out = json.loads(self.published())
        self.assertNotIn(FIELD, out)
        self.assertEqual(stripped, ["audit_corpus.json/" + FIELD])
        self.assertIn("audit_corpus.json", copied)

    def test_the_value_does_not_survive_anywhere_in_the_file(self):
        self.write_study(research_corpus(**{FIELD: SENTINEL}))
        B.vendor(self.study)
        self.assertNotIn(str(SENTINEL), self.published())

    def test_the_removal_is_recorded_on_the_file(self):
        """A silent redaction looks exactly like a field that never existed."""
        self.write_study(research_corpus(**{FIELD: SENTINEL}))
        B.vendor(self.study)
        marker = json.loads(self.published())["_redacted"]
        self.assertEqual(marker["fields"], ["/" + FIELD])
        self.assertIn("OVERLAP_REGISTER.md", marker["why"])

    def test_everything_else_is_published_unchanged(self):
        self.write_study(research_corpus(**{FIELD: SENTINEL}))
        B.vendor(self.study)
        out = json.loads(self.published())
        out.pop("_redacted")
        self.assertEqual(out, research_corpus())

    def test_the_research_original_is_untouched(self):
        self.write_study(research_corpus(**{FIELD: SENTINEL}))
        B.vendor(self.study)
        with open(os.path.join(self.study, "audit_corpus.json")) as f:
            self.assertEqual(json.load(f)[FIELD], SENTINEL)

    def test_renamed_and_nested_variants_are_stripped_too(self):
        claims = research_corpus()["claims"]
        claims[0].update({"retrain_sigma_pp": SENTINEL,
                          "seed_spread": SENTINEL,
                          "per_seed_rates": [SENTINEL, SENTINEL]})
        self.write_study({"claims": claims, "median_variance": SENTINEL})
        B.vendor(self.study)
        self.assertNotIn(str(SENTINEL), self.published())

    def test_the_second_public_corpus_is_stripped_too(self):
        self.write_study(research_corpus(), {"refs": [], FIELD: SENTINEL})
        B.vendor(self.study)
        self.assertNotIn(str(SENTINEL),
                         self.published("reference_sources.json"))


class GuardRefusesTheField(Sandbox):

    def plant(self, name, data):
        with open(os.path.join(self.site, name), "w") as f:
            json.dump(data, f)

    def test_guard_refuses_a_verbatim_copy(self):
        """The old vendoring step, reproduced: the guard must now stop it."""
        self.write_study(research_corpus(**{FIELD: SENTINEL}))
        shutil.copy2(os.path.join(self.study, "audit_corpus.json"),
                     os.path.join(self.site, "source", "audit_corpus.json"))
        with self.assertRaises(B.BuildError) as cm:
            B.guard_register(self.study)
        self.assertIn(FIELD, str(cm.exception))

    def test_guard_covers_both_public_sources(self):
        for name in B.PUBLIC_SOURCE:
            self.plant(name, research_corpus(**{FIELD: SENTINEL}))
            with self.assertRaises(B.BuildError, msg=name):
                B.guard_register(self.study)
            os.remove(os.path.join(self.site, name))

    def test_guard_refuses_it_in_generated_data(self):
        self.plant("claims-data.json", {"summary": {FIELD: SENTINEL}})
        with self.assertRaises(B.BuildError):
            B.guard_register(self.study)

    def test_guard_passes_after_vendoring(self):
        self.write_study(research_corpus(**{FIELD: SENTINEL}))
        B.vendor(self.study)
        B.guard_register(self.study)

    def test_an_exact_name_list_alone_would_have_missed_it(self):
        """Why the guard matches substrings, not only listed names."""
        self.assertNotIn(FIELD, B.FORBIDDEN_KEYS)
        self.assertIsNotNone(B.forbidden_key(FIELD))
        for name in B.PUBLIC_SOURCE + ("claims-data.json",):
            self.assertIsNotNone(B.forbidden_key(FIELD, name, "/" + FIELD))


class BuildOrder(unittest.TestCase):

    def test_the_build_vendors_before_it_guards(self):
        """Guarding first would check the previous build's copy and pass."""
        body = inspect.getsource(B.main)
        build_path = body[body.index("require_study("):]
        self.assertLess(build_path.index("vendor(study)"),
                        build_path.index("guard_register(study)"))


class PublishedCorpusOnDisk(unittest.TestCase):
    """The files this repository actually serves, not constructed ones."""

    def load(self, name):
        with open(os.path.join(REAL_SITE, name)) as f:
            return json.load(f)

    def test_no_public_source_carries_a_register_key(self):
        for name in B.PUBLIC_SOURCE:
            bad = []
            for path, _ in B.walk(self.load(name)):
                leaf = path.rsplit("/", 1)[-1].split("[")[0]
                if leaf and B.forbidden_key(leaf, name, path):
                    bad.append(path)
            self.assertEqual(bad, [], name)

    def test_the_published_corpus_says_what_was_withheld(self):
        corpus = self.load("source/audit_corpus.json")
        self.assertNotIn(FIELD, corpus)
        self.assertIn("/" + FIELD, corpus["_redacted"]["fields"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
