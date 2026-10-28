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

    def _blocked(self):
        # The 3D configurator prototype is only served to the local machine.
        if urlparse(self.path).path.startswith('/configurator') and self.client_address[0] not in ('127.0.0.1', '::1'):
            self.send_error(404)
            return True
        return False

    def do_GET(self):
        if self._blocked():
            return
        self._rewrite_path()
        return super().do_GET()

    def do_HEAD(self):
        if self._blocked():
            return
        self._rewrite_path()
        return super().do_HEAD()

    def log_message(self, format, *args):
        return


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', 4173), ThemePreviewHandler)
    print('Theme preview running on http://localhost:4173')
    server.serve_forever()
