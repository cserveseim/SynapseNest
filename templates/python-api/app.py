from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os

PORT = int(os.environ.get('PORT', '8080'))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = {
            'ok': True,
            'runtime': 'python',
            'service': 'SynapseNest python-api',
            'method': self.command,
            'path': self.path,
        }
        body = (json.dumps(payload, indent=2) + '\n').encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


if __name__ == '__main__':
    HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
