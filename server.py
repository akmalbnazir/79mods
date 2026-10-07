import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


class ThemePreviewHandler(SimpleHTTPRequestHandler):
    def _rewrite_path(self):
        parsed = urlparse(self.path)
        target = parsed.path

        if target == '/collections/all':
            self.path = '/collections/all/index.html'
            return

        if target.startswith('/collections/') or target.startswith('/products/'):
            clean_target = target.rstrip('/')
            local_path = '.' + clean_target
            if os.path.isdir(local_path):
                self.path = clean_target + '/'
                return
            if os.path.isfile(local_path + '.html'):
                self.path = clean_target + '.html'
                return
            if os.path.isfile('.' + target + '/index.html'):
                self.path = target.rstrip('/') + '/index.html'
                return

        if target.startswith('/cart') or target == '/collections' or target == '/products':
            self.path = '/index.html'

    def do_GET(self):
        self._rewrite_path()
        return super().do_GET()

    def do_HEAD(self):
        self._rewrite_path()
        return super().do_HEAD()

    def log_message(self, format, *args):
        return


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', 4173), ThemePreviewHandler)
    print('Theme preview running on http://localhost:4173')
    server.serve_forever()
