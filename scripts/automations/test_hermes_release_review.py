from datetime import datetime
import importlib.util
import io
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "review", Path(__file__).with_name("hermes-release-review.py"),
)
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTests(unittest.TestCase):
    def test_schedule_across_month_boundary(self):
        for timestamp, expected in [
            ("2026-10-30T19:26:59+03:00", False),
            ("2026-10-30T19:27:00+03:00", True),
            ("2026-10-31T19:27:00+03:00", False),
            ("2026-11-03T19:27:00+03:00", True),
        ]:
            self.assertEqual(review.is_due(datetime.fromisoformat(timestamp)), expected)

    def test_child_consumes_prompt_without_inheriting_override(self):
        program = (
            "import json,os,sys; "
            "print(json.dumps({'override':os.environ.get('BB_CLI'),"
            "'prompt':sys.stdin.read(),'project':os.environ['BB_PROJECT_ID']}))"
        )
        with patch.dict(os.environ, BB_CLI="/recursive/bb", BB_PROJECT_ID="proj_test"):
            result = review.spawn_review([sys.executable, "-c", program], "Обзор")
            self.assertEqual(os.environ["BB_CLI"], "/recursive/bb")
        self.assertEqual(result, {"override": None, "prompt": "Обзор", "project": "proj_test"})

    def test_nonzero_exit_is_reported(self):
        with self.assertRaises(subprocess.CalledProcessError) as error:
            review.spawn_review([sys.executable, "-c", "import sys; sys.exit(7)"], "")
        self.assertEqual(error.exception.returncode, 7)

    @unittest.skipUnless(sys.platform.startswith("linux"), "Requires Linux procfs")
    def test_timeout_kills_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            pid_file = Path(directory) / "child.pid"
            program = (
                "import pathlib,subprocess,sys,time; "
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
                f"pathlib.Path({str(pid_file)!r}).write_text(str(child.pid)); "
                "time.sleep(60)"
            )
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    review.spawn_review([sys.executable, "-c", program], "", timeout=1)
                child_pid = int(pid_file.read_text())
                for _ in range(100):
                    stat = Path(f"/proc/{child_pid}/stat")
                    if not stat.exists() or stat.read_text().split()[2] == "Z":
                        break
                    time.sleep(0.01)
                else:
                    self.fail("CLI descendant survived the timeout")
            finally:
                if pid_file.exists():
                    try:
                        os.kill(int(pid_file.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_marker_is_written_only_after_success_and_prevents_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "review.py"
            now = datetime.fromisoformat("2026-10-30T19:27:00+03:00")
            with (
                patch.object(review, "__file__", str(script)),
                patch.object(review, "datetime") as clock,
                patch.dict(os.environ, BB_PROJECT_ID="proj_test"),
                patch.object(review, "spawn_review") as spawn,
                redirect_stdout(io.StringIO()),
            ):
                clock.now.return_value = now
                spawn.side_effect = subprocess.TimeoutExpired("bb", 90)
                with self.assertRaises(subprocess.TimeoutExpired):
                    review.main()
                marker = script.with_name("last-review-date.txt")
                self.assertFalse(marker.exists())
                spawn.side_effect = None
                spawn.return_value = {"id": "thr_test"}
                review.main()
                self.assertEqual(marker.read_text(), "2026-10-30\n")
                review.main()
                self.assertEqual(spawn.call_count, 2)


if __name__ == "__main__":
    unittest.main()
