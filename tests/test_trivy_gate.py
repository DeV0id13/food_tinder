import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / ".github/scripts/check_trivy.py"


def run_gate(tmp_path, payload):
    report = tmp_path / "report.json"
    blocking = tmp_path / "blocking.txt"
    if payload is not None:
        report.write_text(payload, encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(report), str(blocking)],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, blocking.read_text(encoding="utf-8")


def image_report(vulnerabilities):
    return json.dumps(
        {
            "SchemaVersion": 2,
            "ArtifactType": "container_image",
            "Results": [{"Target": "image (alpine)", "Vulnerabilities": vulnerabilities}],
        }
    )


@pytest.mark.parametrize("severity", ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
def test_severity_gate_includes_unfixed(tmp_path, severity):
    payload = image_report(
        [
            {
                "Severity": severity,
                "VulnerabilityID": "CVE-TEST",
                "PkgName": "example",
                "InstalledVersion": "1.0",
                "FixedVersion": "",
            }
        ]
    )
    code, report = run_gate(tmp_path, payload)
    blocked = severity in {"HIGH", "CRITICAL"}
    assert code == int(blocked)
    assert ("CVE-TEST" in report) is blocked
    assert ("fixed=unfixed" in report) is blocked


def test_clean_image_passes(tmp_path):
    assert run_gate(tmp_path, image_report([]))[0] == 0


@pytest.mark.parametrize("payload", [None, "{", "{}", '{"SchemaVersion": 2}'])
def test_invalid_report_fails_closed(tmp_path, payload):
    code, report = run_gate(tmp_path, payload)
    assert code == 1
    assert "Invalid or missing" in report
