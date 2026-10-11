"""Local metrics sink. It collects numeric counters, never note bodies or paths."""
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--phase", type=Path, required=True)
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)

class Handler(BaseHTTPRequestHandler):
    def respond(self, status=200):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self.respond()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 250_000:
            self.respond(413)
            return
        data = json.loads(self.rfile.read(length))
        if isinstance(data, dict):
            data["received"] = time.time()
            data["phase"] = args.phase.read_text().strip() if args.phase.exists() else "setup"
            with args.output.open("a") as output:
                output.write(json.dumps(data) + "\n")
        self.respond()
        self.wfile.write(b"ok")

    def log_message(self, *_):
        pass

print("Local profile sink listening on 127.0.0.1:1467", flush=True)
HTTPServer(("127.0.0.1", 1467), Handler).serve_forever()
