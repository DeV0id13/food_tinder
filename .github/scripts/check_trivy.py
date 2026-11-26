"""Enforce the blocking severity policy from a single full Trivy JSON scan."""

import json
import sys
from pathlib import Path

SEVERITIES = {"UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"}
BLOCKING = {"HIGH", "CRITICAL"}


def check(report_path: Path, blocking_path: Path) -> int:
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report["SchemaVersion"] != 2 or report["ArtifactType"] != "container_image":
            raise ValueError("expected a Trivy v2 container image report")
        results = report["Results"]
        if not isinstance(results, list) or not results:
            raise ValueError("missing image scan results")
        findings = []
        for result in results:
            target = result["Target"]
            vulnerabilities = result.get("Vulnerabilities", [])
            if vulnerabilities is None:
                vulnerabilities = []
            if not isinstance(vulnerabilities, list):
                raise ValueError("invalid vulnerabilities list")
            for vulnerability in vulnerabilities:
                severity = vulnerability["Severity"]
                if severity not in SEVERITIES:
                    raise ValueError(f"invalid severity: {severity}")
                if severity in BLOCKING:
                    findings.append(
                        f"{severity} {vulnerability['VulnerabilityID']} "
                        f"{vulnerability['PkgName']} {vulnerability['InstalledVersion']} "
                        f"fixed={vulnerability.get('FixedVersion') or 'unfixed'} "
                        f"target={target}"
                    )
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        blocking_path.write_text(f"Invalid or missing Trivy report: {error}\n", encoding="utf-8")
        return 1

    summary = f"Blocking HIGH/CRITICAL vulnerabilities: {len(findings)}"
    blocking_path.write_text("\n".join([summary, *findings]) + "\n", encoding="utf-8")
    print(summary)
    return int(bool(findings))


if __name__ == "__main__":
    sys.exit(check(Path(sys.argv[1]), Path(sys.argv[2])))
