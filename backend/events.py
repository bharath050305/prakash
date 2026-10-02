"""Tiny in-process pub/sub used for Server-Sent Events (live dashboards, toasts, notifications)."""
import json
import queue
import threading


class Sub:
    def __init__(self, role, user_id):
        self.role, self.user_id = role, user_id
        self.q = queue.Queue(maxsize=200)


class Hub:
    def __init__(self):
        self._subs = []
        self._lock = threading.Lock()

    def subscribe(self, role, user_id):
        s = Sub(role, user_id)
        with self._lock:
            self._subs.append(s)
        return s

    def unsubscribe(self, s):
        with self._lock:
            if s in self._subs:
                self._subs.remove(s)

    def publish(self, type_, data, roles=("admin",), user_ids=()):
        """Deliver to every subscriber whose role is in `roles` or whose user id is in `user_ids`."""
        msg = json.dumps({"type": type_, "data": data})
        with self._lock:
            targets = [s for s in self._subs if s.role in roles or s.user_id in user_ids]
        for s in targets:
            try:
                s.q.put_nowait(msg)
            except queue.Full:
                pass

    def count(self):
        return len(self._subs)


hub = Hub()
