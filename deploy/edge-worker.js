export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const origin = new URL(request.url);
    origin.protocol = 'https:';
    origin.hostname = '2.154.66.148.host.secureserver.net';
    origin.port = '8443';
    const headers = new Headers(request.headers);
    headers.set('Host', '2.154.66.148.host.secureserver.net');
    headers.set('X-Forwarded-Proto', 'https');
    headers.set('X-Forwarded-Host', incoming.host);
    return fetch(origin.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual'
    });
  }
};
