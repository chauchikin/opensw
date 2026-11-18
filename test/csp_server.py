# Serve dist/ with a content security policy like the claude.ai page host.
import http.server, functools, sys
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "font-src data:; img-src data: blob:; connect-src 'self'")
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP)
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('', int(sys.argv[1])), functools.partial(H, directory='dist')).serve_forever()
