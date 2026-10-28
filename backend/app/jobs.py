"""Tiny in-memory background job runner. The frontend polls GET /api/jobs/{id}."""
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

log = logging.getLogger("shortsforge.jobs")


class UserError(Exception):
    """An error whose message is safe and friendly enough to show in the UI."""


class Job:
    def __init__(self, kind: str):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.status = "queued"  # queued | running | done | error
        self.progress = 0.0
        self.step = "Waiting to start…"
        self.result: Any = None
        self.error: str | None = None
        self.created = time.time()

    def update(self, progress: float | None = None, step: str | None = None) -> None:
        if progress is not None:
            self.progress = max(0.0, min(1.0, progress))
        if step is not None:
            self.step = step

    def to_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "status": self.status,
            "progress": round(self.progress, 3), "step": self.step,
            "result": self.result, "error": self.error,
        }


_jobs: dict[str, Job] = {}
_lock = threading.Lock()
# Downloads can run side by side; renders are CPU heavy so they go one at a time.
_pools = {
    "download": ThreadPoolExecutor(max_workers=3, thread_name_prefix="dl"),
    "render": ThreadPoolExecutor(max_workers=1, thread_name_prefix="render"),
    "footage": ThreadPoolExecutor(max_workers=2, thread_name_prefix="footage"),
}


def submit(kind: str, fn: Callable[[Job], Any], pool: str = "download") -> Job:
    job = Job(kind)
    with _lock:
        _jobs[job.id] = job

    def runner() -> None:
        job.status = "running"
        try:
            job.result = fn(job)
            job.progress = 1.0
            job.status = "done"
        except UserError as e:
            job.error = str(e)
            job.status = "error"
        except Exception as e:  # never leak a stack trace to the UI
            log.exception("Job %s failed", job.id)
            job.error = f"Something went wrong: {str(e).splitlines()[0][:300] if str(e) else type(e).__name__}"
            job.status = "error"

    _pools[pool].submit(runner)
    return job


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)
