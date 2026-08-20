import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { createHttpTransport } from '../dist/util/HttpTransport.js'

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve(server.address()))
    })
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
    })
}

test('fetch transport sends requests and enforces timeouts', async () => {
    const server = http.createServer((request, response) => {
        if (request.url === '/slow') {
            setTimeout(() => response.end('late'), 200)
            return
        }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ method: request.method, url: request.url }))
    })
    const address = await listen(server)

    try {
        const transport = createHttpTransport(1000, undefined, true)
        const response = await transport.fetch(`http://127.0.0.1:${address.port}/ok?q=termux`)
        assert.deepEqual(await response.json(), { method: 'GET', url: '/ok?q=termux' })

        await assert.rejects(
            transport.fetch(`http://127.0.0.1:${address.port}/slow`, { timeout: 20 }),
            error => error?.name === 'AbortError'
        )
    } finally {
        await close(server)
    }
})

test('fetch transport supports an HTTP proxy', async () => {
    const target = http.createServer((request, response) => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ url: request.url, proxy: request.headers['x-transport-proxy'] }))
    })
    const targetAddress = await listen(target)

    const proxy = http.createServer((request, response) => {
        const targetUrl = new URL(request.url)
        const upstream = http.request(
            {
                hostname: targetUrl.hostname,
                port: targetUrl.port,
                path: targetUrl.pathname + targetUrl.search,
                method: request.method,
                headers: { ...request.headers, 'x-transport-proxy': 'yes' }
            },
            upstreamResponse => {
                response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
                upstreamResponse.pipe(response)
            }
        )
        request.pipe(upstream)
    })
    const proxyAddress = await listen(proxy)

    try {
        const transport = createHttpTransport(1000, `http://127.0.0.1:${proxyAddress.port}`, true)
        const response = await transport.fetch(`http://127.0.0.1:${targetAddress.port}/proxied?q=1`)
        assert.deepEqual(await response.json(), { url: '/proxied?q=1', proxy: 'yes' })
    } finally {
        await Promise.all([close(proxy), close(target)])
    }
})

test('fetch transport rejects unsupported SOCKS4 proxies', () => {
    assert.throws(() => createHttpTransport(1000, 'socks4://127.0.0.1:1080', true), /does not support SOCKS4 proxies/)
})
