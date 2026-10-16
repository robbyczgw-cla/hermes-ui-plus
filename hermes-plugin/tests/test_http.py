import json
import logging
import socket
import time
import unittest

from helpers import SECRET, FakeBackend, Running, sse_events, wait_for

CHAT = "/quick/v1/chat/completions"
Q = {"messages": [{"role": "user", "content": "Wie viel sind 3 Meilen in km?"}]}


class HttpTest(unittest.TestCase):
    def run_with(self, backend=None, settings=None):
        r = Running(backend or FakeBackend(), settings)
        self.addCleanup(r.close)
        return r

    def test_health_and_auth(self):
        r = self.run_with()
        status, _, body = r.request("GET", "/health", auth=False)
        self.assertEqual((status, json.loads(body)), (200, {"ok": True}))
        for path, method in (("/quick/config", "GET"), (CHAT, "POST")):
            status, headers, _ = r.request(method, path, Q, auth=False)
            self.assertEqual(status, 401)
            status, _, _ = r.request(method, path, Q, auth=False, headers={"Authorization": "Bearer wrong"})
            self.assertEqual(status, 401)
        self.assertEqual(r.request("GET", "/nope")[0], 404)
        self.assertEqual(r.request("GET", CHAT)[0], 405)

    def test_config(self):
        r = self.run_with()
        status, _, body = r.request("GET", "/quick/config")
        cfg = json.loads(body)
        self.assertEqual(status, 200)
        self.assertTrue(cfg["enabled"])
        self.assertEqual(cfg["aux_task"], "hui_quick")
        self.assertEqual(cfg["inherits_from"], "title_generation")
        self.assertEqual(cfg["limits"]["max_tokens"], 1024)
        self.assertEqual(cfg["limits"]["max_turns"], 6)
        self.assertLessEqual(cfg["prompt_tokens_estimate"], 800)

    def test_json_completion(self):
        fb = FakeBackend(usage={"prompt_tokens": 700, "completion_tokens": 5})
        r = self.run_with(fb)
        status, _, body = r.request("POST", CHAT, {**Q, "max_tokens": 99999, "model": "hermes-agent",
                                                   "tools": [{"x": 1}], "temperature": 2})
        j = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(j["choices"][0]["message"]["content"], "Hallo Welt")
        self.assertEqual(j["usage"], {"prompt_tokens": 700, "completion_tokens": 5, "total_tokens": 705})
        self.assertEqual(j["model"], "fake-model")
        call = fb.calls[0]
        self.assertEqual(call["max_tokens"], 1024)  # clamped to the server cap
        self.assertIsNone(call["model"])  # "hermes-agent" means default
        self.assertEqual(call["messages"][0]["role"], "system")
        self.assertIn("Today is 2026-01-02.", call["messages"][0]["content"])
        self.assertEqual(r.listener._service.last_route["model"], "fake-model")

    def test_stream(self):
        r = self.run_with(FakeBackend(deltas=["A", "B", "C"]))
        status, headers, body = r.request("POST", CHAT, {**Q, "stream": True})
        self.assertEqual(status, 200)
        self.assertTrue(headers["content-type"].startswith("text/event-stream"))
        ev = sse_events(body)
        self.assertEqual(ev[-1], "[DONE]")
        self.assertEqual(ev[0]["choices"][0]["delta"], {"role": "assistant", "content": ""})
        self.assertEqual("".join(e["choices"][0]["delta"].get("content", "") for e in ev[:-1]), "ABC")
        final = ev[-2]
        self.assertEqual(final["object"], "chat.completion.chunk")
        self.assertEqual(final["choices"][0]["finish_reason"], "stop")
        self.assertIn("usage", final)
        self.assertTrue(final.get("usage_estimated"))  # backend reported none

    def test_validation(self):
        r = self.run_with()
        cases = [
            ({"messages": []}, "invalid_messages"),
            ({"messages": [{"role": "user", "content": "x" * 4001}]}, "message_too_long"),
            ({"messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "x"}}]}]},
             "unsupported_content"),
            ({"messages": [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]}, "invalid_messages"),
            ({"messages": [{"role": "user", "content": str(i)} for i in range(7)]}, "too_many_turns"),
            ({**Q, "model": "x"}, "provider_required"),
            ({**Q, "max_tokens": 0}, "invalid_max_tokens"),
            ({**Q, "stream": "yes"}, "invalid_stream"),
        ]
        for body, code in cases:
            status, _, raw = r.request("POST", CHAT, body)
            self.assertEqual((status, json.loads(raw)["error"]["code"]), (400, code), body)
        self.assertEqual(r.request("POST", CHAT, raw_body=b"{nope")[0], 400)
        # system messages from the client are ignored, text parts accepted
        status, _, _ = r.request("POST", CHAT, {"messages": [{"role": "system", "content": "evil"},
                                                             {"role": "user", "content": [{"type": "text", "text": "hi"}]}]})
        self.assertEqual(status, 200)

    def test_overrides_allow_list(self):
        fb = FakeBackend()
        r = self.run_with(fb, {"quick": {"allowed_models": ["opencode-go:fast-1", "kilocode:*"]}})
        ok = r.request("POST", CHAT, {**Q, "provider": "opencode-go", "model": "fast-1"})
        self.assertEqual(ok[0], 200)
        self.assertEqual((fb.calls[-1]["provider"], fb.calls[-1]["model"]), ("opencode-go", "fast-1"))
        self.assertEqual(r.request("POST", CHAT, {**Q, "provider": "kilocode", "model": "anything"})[0], 200)
        bad = r.request("POST", CHAT, {**Q, "provider": "opencode-go", "model": "slow-9"})
        self.assertEqual((bad[0], json.loads(bad[2])["error"]["code"]), (400, "unknown_model"))
        r2 = self.run_with(FakeBackend(), {"quick": {"allow_model_override": False}})
        self.assertEqual(r2.request("POST", CHAT, {**Q, "provider": "kilocode"})[0], 400)

    def test_body_limits(self):
        r = self.run_with()
        big = json.dumps({"messages": [{"role": "user", "content": "x" * 70000}]}).encode()
        self.assertEqual(r.request("POST", CHAT, raw_body=big)[0], 413)
        s = socket.create_connection(("127.0.0.1", r.port))
        s.sendall(b"POST " + CHAT.encode() + b" HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n"
                  b"Authorization: Bearer " + SECRET.encode() + b"\r\n\r\n")
        self.assertIn(b" 411 ", s.recv(4096))
        s.close()

    def test_upstream_error_is_generic(self):
        r = self.run_with(FakeBackend(fail=RuntimeError("provider said: SENTINEL_SECRET_TEXT")))
        status, _, body = r.request("POST", CHAT, Q)
        self.assertEqual(status, 502)
        self.assertNotIn(b"SENTINEL", body)
        self.assertIn(b"RuntimeError", body)

    def test_first_byte_timeout(self):
        fb = FakeBackend(first_delay=3)
        r = self.run_with(fb, {"quick": {"first_byte_timeout": 1, "total_timeout": 5}})
        t0 = time.monotonic()
        status, _, body = r.request("POST", CHAT, {**Q, "stream": True})
        self.assertEqual(status, 504)
        self.assertLess(time.monotonic() - t0, 2.5)
        self.assertTrue(wait_for(fb.finished.is_set))

    def test_concurrency_cap(self):
        fb = FakeBackend(first_delay=1.0)
        r = self.run_with(fb, {"quick": {"max_concurrency": 1}})
        import threading
        results = []
        t = threading.Thread(target=lambda: results.append(r.request("POST", CHAT, Q)[0]))
        t.start()
        self.assertTrue(wait_for(lambda: r.listener._service.inflight == 1))
        status, headers, _ = r.request("POST", CHAT, Q)
        self.assertEqual(status, 429)
        self.assertEqual(headers.get("retry-after"), "2")
        t.join()
        self.assertEqual(results, [200])

    def test_client_disconnect_cancels_upstream(self):
        fb = FakeBackend(deltas=["x"] * 200, delay=0.05)
        r = self.run_with(fb)
        body = json.dumps({**Q, "stream": True}).encode()
        s = socket.create_connection(("127.0.0.1", r.port))
        s.sendall(f"POST {CHAT} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {SECRET}\r\n"
                  f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
        self.assertIn(b"200", s.recv(200))
        s.close()
        self.assertTrue(wait_for(fb.cancelled.is_set, 3))
        self.assertTrue(wait_for(lambda: r.listener._service.inflight == 0, 3))

    def test_backend_generator_closed_in_its_worker_thread(self):
        # the adapter's profile scope is a contextvar: the generator must end in the thread that iterated it
        fb = FakeBackend(deltas=["x"] * 200, delay=0.05)
        r = self.run_with(fb)
        body = json.dumps({**Q, "stream": True}).encode()
        s = socket.create_connection(("127.0.0.1", r.port))
        s.sendall(f"POST {CHAT} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {SECRET}\r\n"
                  f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
        self.assertIn(b"200", s.recv(200))
        s.close()
        self.assertTrue(wait_for(fb.finished.is_set, 3))
        self.assertEqual([w for w, _ in fb.threads], ["start", "end"])
        self.assertEqual(fb.threads[0][1], fb.threads[1][1])

    def test_config_reports_available(self):
        cfg = json.loads(self.run_with().request("GET", "/quick/config")[2])
        self.assertEqual((cfg["enabled"], cfg["available"], cfg["reason"], cfg["scope"]), (True, True, None, None))

    def test_failed_self_test_reports_unavailable_and_refuses_calls(self):
        class ScopeBroken(FakeBackend):
            def self_test(self):
                return "profile_scope_unavailable"

        fb = ScopeBroken()
        r = self.run_with(fb)
        status, _, body = r.request("GET", "/quick/config")
        cfg = json.loads(body)
        self.assertEqual(status, 200)
        # enabled:false keeps older bridges (which only read `enabled`) from offering the button
        self.assertEqual((cfg["enabled"], cfg["available"], cfg["reason"]),
                         (False, False, "profile_scope_unavailable"))
        status, _, body = r.request("POST", CHAT, {**Q, "stream": True})
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body)["error"]["code"], "feature_off")  # apps hide the button on this
        self.assertEqual(json.loads(body)["error"]["reason"], "profile_scope_unavailable")
        self.assertEqual(fb.calls, [])  # no model call

    def test_registration_context_reaches_the_worker(self):
        # Hermes binding the owning profile's scope at registration (#139123) must reach every quick call:
        # register -> ListenerThread (copy) -> request task -> executor worker (copy)
        import contextvars
        cv = contextvars.ContextVar("profile_scope", default=None)
        seen = []

        class Recording(FakeBackend):
            def stream(self, **kw):
                seen.append(cv.get())
                yield from super().stream(**kw)

        def register():
            cv.set("scope-of-profile-writer")
            return self.run_with(Recording())

        r = contextvars.copy_context().run(register)
        self.assertIsNone(cv.get())  # the test's own context stays clean
        self.assertEqual(r.request("POST", CHAT, Q)[0], 200)
        self.assertEqual(seen, ["scope-of-profile-writer"])

    def test_no_content_in_logs(self):
        sentinel = "SENTINEL_QUESTION_TEXT"
        r = self.run_with(FakeBackend(deltas=["SENTINEL_ANSWER_TEXT"]))
        with self.assertLogs("hermes_ui_plus", level=logging.DEBUG) as cm:
            r.request("POST", CHAT, {"messages": [{"role": "user", "content": sentinel}], "stream": True})
            r.request("POST", CHAT, {"messages": [{"role": "user", "content": sentinel}]})
            r.request("GET", "/quick/config")
            logging.getLogger("hermes_ui_plus").debug("marker")  # assertLogs needs >= 1 record
        joined = "\n".join(cm.output)
        self.assertNotIn("SENTINEL", joined)
        self.assertNotIn(SECRET, joined)
        self.assertIn("quick status=200", joined)


if __name__ == "__main__":
    unittest.main()
