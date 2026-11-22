"""The Python dev server keeps the playables' /studio/ URLs, including directory URLs."""
import http.client
import importlib.util
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("playables_serve", ROOT / "playables" / "serve.py")
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)


class PlayablesServeTest(unittest.TestCase):
    def test_file_and_directory_urls(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), serve.PreviewHandler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            for path in ["/studio/previewer.html", "/studio/courtyard/", "/studio/blood-sea/", "/studio/courtyard/index.html"]:
                conn = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1])
                conn.request("GET", path)
                status = conn.getresponse().status
                conn.close()
                self.assertEqual(status, 200, path)
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
