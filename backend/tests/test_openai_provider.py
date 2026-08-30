"""OpenAI provider — verified against a local mock of the Chat Completions
endpoint (the real api.openai.com is not reachable from CI). Proves the
request shape (JSON mode, messages, model) and response parsing (content +
token usage) are correct, so the real call works when egress is available.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend.ai.providers.openai import OpenAIProvider, ProviderError


class _MockOpenAI(BaseHTTPRequestHandler):
    last_request = None  # type: ignore[attr-defined]

    def log_message(self, *a):  # silence
        pass

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        type(self).last_request = {  # type: ignore[attr-defined]
            "path": self.path,
            "auth": self.headers.get("Authorization"),
            "body": body,
        }
        reply = {
            "model": body.get("model", "mock"),
            "choices": [
                {"message": {"role": "assistant",
                              "content": '{"type": "answer", "kind": "fact", "title": "t", "message": "m", "basis": {"period": "last_30_days", "sources": ["orders"]}, "follow_ups": [], "links": [], "actions": []}'}}
            ],
            "usage": {"prompt_tokens": 123, "completion_tokens": 45},
        }
        data = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _start_mock() -> tuple[str, ThreadingHTTPServer]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _MockOpenAI)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_address[1]}/v1/chat/completions", server


def test_provider_sends_json_mode_request_and_parses_response():
    url, server = _start_mock()
    try:
        _MockOpenAI.last_request = None
        provider = OpenAIProvider(model="gpt-4o-mini", api_key="sk-test")
        provider.API_URL = url  # point the real client at the local mock

        result = provider.complete(
            system="you are coop",
            messages=[{"role": "user", "content": "hi"}],
        )

        # Request shape: auth header, model, JSON mode, system + user messages.
        req = _MockOpenAI.last_request
        assert req["path"].endswith("/v1/chat/completions")
        assert req["auth"] == "Bearer sk-test"
        assert req["body"]["model"] == "gpt-4o-mini"
        assert req["body"]["response_format"] == {"type": "json_object"}
        roles = [m["role"] for m in req["body"]["messages"]]
        assert roles == ["system", "user"]

        # Response parsing: content + token usage.
        assert result.model == "gpt-4o-mini"
        assert result.input_tokens == 123
        assert result.output_tokens == 45
        parsed = json.loads(result.text)
        assert parsed["kind"] == "fact"
    finally:
        server.shutdown()


def test_provider_requires_a_key():
    try:
        OpenAIProvider(model="m", api_key="")
        assert False, "should have raised"
    except ProviderError:
        pass
