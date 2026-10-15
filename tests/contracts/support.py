"""
Payload and model-reply builders for the RecourseAdjudicator contract tests.
"""

import json
from pathlib import Path

CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "recourse_adjudicator.py"

# Every adjudication prompt starts with this sentence, so one pattern catches
# both the leader's call and the validator's re-run.
PROMPT = r"You are an adjudicator for a machine-to-machine commerce protocol"


def model_reply(ruling: dict) -> str:
    """
    A model reply, encoded the way it crosses the GenVM boundary.

    A GenVM host returns a JSON-format reply as *text* and the SDK decodes it.
    genlayer-test's mock also decodes JSON strings before handing them over, so
    a reply registered as plain JSON would be decoded twice. Wrapping it once
    more makes the mock behave like the host - and the contract accepts either
    shape, so the tests hold whichever layer ends up decoding.
    """
    return json.dumps(json.dumps(ruling))


def buyer_wins(terms=("minimum_sources",), summary="Two of five sources defeats the purpose."):
    return {
        "decision": "BUYER_WINS",
        "material_breach": True,
        "violated_terms": list(terms),
        "satisfied_terms": [],
        "refund_percent": 100,
        "recommended_settlement": "REFUND",
        "reasoning_summary": summary,
    }


def merchant_wins(summary="Every contested term was met; dissatisfaction is not breach."):
    return {
        "decision": "MERCHANT_WINS",
        "material_breach": False,
        "violated_terms": [],
        "satisfied_terms": ["minimum_sources"],
        "refund_percent": 0,
        "recommended_settlement": "RELEASE",
        "reasoning_summary": summary,
    }


def split(percent, terms=("minimum_sources",), summary="Three of five sources still carries most of the value."):
    return {
        "decision": "SPLIT",
        "material_breach": True,
        "violated_terms": list(terms),
        "satisfied_terms": [],
        "refund_percent": percent,
        "recommended_settlement": "SPLIT",
        "reasoning_summary": summary,
    }


def payload(**overrides) -> str:
    """An adjudication payload shaped exactly as the protocol builds one."""
    body = {
        "agreementHash": "0x" + "11" * 32,
        "evidenceHash": "0x" + "22" * 32,
        "inputsHash": "0x" + "33" * 32,
        "contestedTerms": [
            {
                "id": "minimum_sources",
                "label": "Minimum sources",
                "operator": "GTE",
                "expected": "5",
                "mandatory": True,
            }
        ],
        "deterministicFindings": [
            {"termId": "minimum_sources", "expression": "3 < 5", "result": "BREACH"},
            {"termId": "geography", "expression": "Lagos = Lagos", "result": "PASS"},
        ],
        "buyerClaim": "I needed five independent sources to size a market entry. Three arrived.",
        "merchantStatement": "Three strong sources cover the market adequately.",
    }
    body.update(overrides)
    return json.dumps(body)


def graduated(**overrides) -> str:
    return payload(remedyMode="GRADUATED", **overrides)


def address_hex(address) -> str:
    """Lower-case 0x hex for an Address or the raw bytes Direct Mode reports."""
    if hasattr(address, "as_hex"):
        return address.as_hex.lower()
    if isinstance(address, (bytes, bytearray)):
        return "0x" + bytes(address).hex()
    return str(address).lower()


def checksummed(address) -> str:
    """EIP-55 form, as a client such as viem would print the same address."""
    import genlayer  # importable once a contract has been deployed in the test

    raw = address if isinstance(address, (bytes, bytearray)) else bytes.fromhex(address_hex(address)[2:])
    return genlayer.Address(bytes(raw)).as_hex
