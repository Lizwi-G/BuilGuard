"""
BuildGuard dev server — Python's built-in static server with one change:
it tells the browser NOT to cache anything.

Python's plain `http.server` sends no cache headers, so browsers keep old
copies of JS/CSS for a while and you end up staring at code you already
fixed. This serves the same folder with `Cache-Control: no-store` so every
reload shows the current files. Use this for development; production
hosting (Netlify, GitHub Pages) sets proper cache headers itself.

    python dev-server.py            # http://localhost:8765
    python dev-server.py 3000       # custom port
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quieter log: skip favicon noise.
        if args and "favicon" in str(args[0]):
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"Serving HTTP on port {port} (http://localhost:{port}/) with caching disabled ...", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
