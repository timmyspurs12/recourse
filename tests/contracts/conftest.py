"""
Fixtures for the RecourseAdjudicator contract tests.

These run the real contract source in genlayer-test's Direct Mode: the
contract's own Python, the GenLayer SDK named by its runner pin, and an
in-memory VM with mocked model replies. No network, no Studio, no fee.

    pip install -r tests/contracts/requirements.txt
    pytest tests/contracts -q          # or: npm run test:contract

Direct Mode downloads the GenVM release that ships the runner pinned on line 2
of the contract. If you change that pin, set GENVM_VERSION to the matching
release (v0.6.0-rc9 for `babwp9t3...`).
"""

import sys

import pytest

from support import CONTRACT


@pytest.fixture
def adjudicator(direct_deploy):
    return direct_deploy(str(CONTRACT))


@pytest.fixture
def contract_ns(adjudicator):
    """
    The contract module's namespace, for testing its pure helpers directly.

    Direct Mode returns a proxy around the real instance; the instance's class
    was defined by the contract file, whose module the loader registers.
    """
    instance = object.__getattribute__(adjudicator, "_instance")
    return vars(sys.modules[type(instance).__module__])
