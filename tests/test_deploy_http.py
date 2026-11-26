import os
import subprocess
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
HOST = "130.193.45.53"
READY_PATH = "/api/v1/ready/"
READY = (200, b'{ "status": "ok" }')
FRONTEND = (200, b'<html><title>FoodTinder</title><div id="app"></div></html>')
UNAVAILABLE = (503, b'{"status":"unavailable"}')


@pytest.fixture
def http_smoke(tmp_path):
    requests = []
    responses = deque()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.path, self.headers["Host"]))
            status, body = responses.popleft() if responses else (404, b"")
            self.send_response(status)
            if status == 301:
                self.send_header("Location", "/redirected/")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    fake_sleep = tmp_path / "sleep"
    fake_sleep.write_text("#!/bin/sh\nexit 0\n")
    fake_sleep.chmod(0o755)
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        worker = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02})
        worker.start()

        def run(*replies):
            responses.extend(replies)
            result = subprocess.run(
                [
                    "bash",
                    str(ROOT / "deploy/check-http.sh"),
                    f"http://127.0.0.1:{server.server_port}",
                    HOST,
                ],
                env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"},
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result, requests

        try:
            yield run
        finally:
            server.shutdown()
            worker.join()


def test_smoke_accepts_http_200_and_retries_temporary_readiness_failure(http_smoke):
    result, requests = http_smoke(UNAVAILABLE, READY, FRONTEND)
    assert result.returncode == 0, result.stderr
    assert requests == [(READY_PATH, HOST), (READY_PATH, HOST), ("/", HOST)]


@pytest.mark.parametrize(
    ("replies", "path"),
    [
        ([(301, b"")], READY_PATH),
        ([READY, (301, b"")], "/"),
        ([(200, b'{"status":"unavailable"}')], READY_PATH),
        ([READY, (200, b"unexpected frontend")], "/"),
    ],
)
def test_smoke_rejects_redirects_and_wrong_bodies(http_smoke, replies, path):
    result, requests = http_smoke(*replies)
    assert result.returncode == 1
    assert result.stderr.startswith(f"{path} ")
    expected = [READY_PATH] if path == READY_PATH else [READY_PATH, "/"]
    assert requests == [(target, HOST) for target in expected]


def test_smoke_stops_after_six_readiness_failures(http_smoke):
    result, requests = http_smoke(*([UNAVAILABLE] * 6))
    assert result.returncode == 1
    assert "after 6 attempts (503)" in result.stderr
    assert requests == [(READY_PATH, HOST)] * 6


def test_deploy_heredoc_passes_no_stdin_to_checks(tmp_path):
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    step = next(step for step in workflow["jobs"]["deploy"]["steps"] if step.get("run"))
    remote_script = step["run"].split("<<'REMOTE'\n", 1)[1].split("\nREMOTE\n", 1)[0]
    subprocess.run(["bash", "-n"], input=remote_script, text=True, check=True)

    def stub(name, script):
        path = tmp_path / name
        path.write_text(script)
        path.chmod(0o755)

    (tmp_path / ".env.prod").write_text("SITE_ADDRESS=:80\n")
    (tmp_path / "deploy").mkdir()
    (tmp_path / "deploy/check-http.sh").write_text('printf "public %s %s\\n" "$1" "$2"\n')
    (tmp_path / "deploy/check-monitoring.sh").write_text('printf "monitoring %s\\n" "$1"\n')
    stub("git", '#!/bin/sh\nif [ "$1" = rev-parse ]; then printf "test-sha\\n"; fi\n')
    stub(
        "sudo",
        """#!/bin/sh
case " $* " in
  *" ps --status running --services "*) printf 'postgres\nweb\nproxy\n' ;;
  *" exec -T web "*)
    if read -r unexpected; then
      printf 'Deploy exec inherited the script stdin\n' >&2
      exit 27
    fi
    case " $* " in
      *" manage.py shell "*) printf 'internal check\n' ;;
      *) printf '130.193.45.53\n' ;;
    esac
    ;;
esac
""",
    )
    result = subprocess.run(
        ["bash", "-s", "--", "test-sha"],
        input=remote_script.replace("cd /opt/foodtinder", 'cd -- "$FOODTINDER_SMOKE_DIR"')
        + '\nprintf "heredoc complete\\n"\n',
        env={
            **os.environ,
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "FOODTINDER_SMOKE_DIR": str(tmp_path),
        },
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        "internal check",
        f"public http://127.0.0.1 {HOST}",
        "monitoring test-sha",
        "heredoc complete",
    ]
