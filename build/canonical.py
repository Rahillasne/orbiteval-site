"""Canonical serialisation for the site's published data files.

Orbit publishes a commit, a corpus hash and a claim that the generated tree
can be reproduced. That claim is only worth something if two people who run
the build get the same bytes, and until now they did not.

THE BUG THIS EXISTS TO FIX. CPython 3.12 changed the builtin `sum()` to use
Neumaier compensated summation over floats, where 3.11 accumulated naively.
`core.decompose` sums squared deviations, so the same input gave
`0x1.f10667f90d9d5p-11` on 3.11 and `0x1.f10667f90d9d4p-11` on 3.12 and 3.14.
One unit in the last place, which propagated through a square root and a
division into the published `coef_min` and made the generated tree differ by
interpreter. Each interpreter was perfectly deterministic; they disagreed
with each other, which is worse, because it looks like reproducibility right
up until someone else checks.

WHY ROUNDING RATHER THAN A CHANGE UPSTREAM. The obvious repair is
`math.fsum`, which is correctly rounded on every version. But `core.py`
belongs to a submitted paper whose audit verifies several hundred numbers
against it, and quietly shifting its arithmetic to tidy a website would be
the wrong trade made by the wrong person. That change belongs to the
research side, deliberately, with the audit re-run. It is recorded, not
performed here.

Rounding at the publication boundary is also the more honest artifact. A
seventeen-significant-digit float asserts a precision this quantity does not
have: its last two digits depend on the order the summation happened to take.
Twelve significant digits is still nine orders of magnitude finer than
anything the site renders, and it is identical on every interpreter.

    >>> canonical({"coef": 0.019409683130415877})
    {'coef': 0.019409683130415}

Booleans are left alone, because `bool` is a subclass of `int` and a rounded
`True` would serialise as a number.
"""
import math

SIGNIFICANT = 12


def canonical(node, sig=SIGNIFICANT):
    """Every float in a nested structure, rounded to `sig` significant digits.

    Ints, bools, strings and None pass through untouched. Non-finite floats
    pass through too: they are already interpreter-independent, and rounding
    them would only turn a clear nan into a confusing one.
    """
    if isinstance(node, dict):
        return {k: canonical(v, sig) for k, v in node.items()}
    if isinstance(node, (list, tuple)):
        return [canonical(v, sig) for v in node]
    if isinstance(node, bool) or not isinstance(node, float):
        return node
    if not math.isfinite(node):
        return node
    return float("{:.{}g}".format(node, sig))


def is_canonical(value, sig=SIGNIFICANT):
    """True if `value` is already at canonical precision.

    The guard in build.py uses this to fail a build whose exporter forgot to
    canonicalise, so that the next float that starts drifting is caught by a
    check rather than by a stranger diffing the site.
    """
    if isinstance(value, bool) or not isinstance(value, float):
        return True
    if not math.isfinite(value):
        return True
    return value == float("{:.{}g}".format(value, sig))
