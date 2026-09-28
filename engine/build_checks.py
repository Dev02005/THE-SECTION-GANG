"""
Run the pre-approval checks on the published plan.

    python -m engine.build_checks

Reads web/public/data/plan.json - the artefact the site serves and the
database is seeded from - rebuilds its instance from the seed it records, and
writes web/public/data/checks.json beside it. The plan, its fingerprint and
the database are untouched.

Exits non-zero if any check fails, and still writes the file, so the site
shows exactly which check failed rather than nothing.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from engine.core.synthetic import build_instance
from engine.models.pricing import price_instance
from engine.validate import all_passed, check_plan


def main() -> None:
    ap = argparse.ArgumentParser(description="Pre-approval checks for the plan")
    ap.add_argument("--plan", default="web/public/data/plan.json")
    ap.add_argument("--out", default="web/public/data/checks.json")
    args = ap.parse_args()

    payload = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    seed = payload["provenance"]["seed"]
    n = len(payload["optimised"]["tasks"])
    instance = price_instance(build_instance(n, seed=seed))
    known = {t.tid for t in instance["tasks"]}
    missing = [t["id"] for t in payload["optimised"]["tasks"] if t["id"] not in known]
    if missing:
        raise SystemExit(f"plan and rebuilt instance disagree: {missing[:5]}")

    checks = check_plan(payload, instance)
    ok = all_passed(checks)
    out = Path(args.out)
    out.write_text(json.dumps({
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        #  Which plan these checks are OF - the page shows them only beside it.
        "plan": {
            "objective": payload["solver"]["objective"],
            "seed": seed,
            "blocks": len(payload["optimised"]["blocks"]),
            "generatedAt": payload["generatedAt"],
        },
        "passed": ok,
        "checks": checks,
    }, indent=2), encoding="utf-8")
    for c in checks:
        mark = "pass" if c["passed"] else "FAIL"
        print(f"  {mark}  {c['id']:5s} {c['name']}  ({c['examined']} examined)")
    print(f"wrote {out}: {sum(c['passed'] for c in checks)} of {len(checks)} pass")
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
