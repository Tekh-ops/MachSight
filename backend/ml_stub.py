# STUB — only reason() is fake here. detector.score_reading() is the real thing, already wired into main.py.


def reason(evidence: dict, history: list) -> dict:
    return {
        "action": "diagnose",
        "diagnosis": "stub — detector reasons: " + str(evidence.get("reasons", [])),
        "confidence": 0.5,
    }
