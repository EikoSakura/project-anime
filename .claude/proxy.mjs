import http from "node:http";

const TARGET = "http://localhost:30000";

const server = http.createServer((req, res) => {
  const proxyReq = http.request(TARGET + req.url, {
    method: req.method,
    headers: { ...req.headers, host: "localhost:30000" }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", () => {
    res.writeHead(502);
    res.end("Proxy error");
  });
  req.pipe(proxyReq);
});

server.listen(30001, () => console.log("Proxy ready on http://localhost:30001"));
