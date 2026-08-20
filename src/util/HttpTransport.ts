import { createRequire } from 'node:module'

import type { ImpitResponse, RequestInit as ImpitRequestInit } from 'impit'

import { isTermuxRuntime } from './RuntimePlatform'

export interface HttpTransport {
    fetch(resource: string, init?: ImpitRequestInit): Promise<ImpitResponse>
}

type ImpitConstructor = new (options?: { browser?: string; proxyUrl?: string; timeout?: number }) => HttpTransport

type FetchTransportModule = {
    fetch(resource: string, init?: RequestInit & { dispatcher?: unknown }): Promise<Response>
    ProxyAgent: new (proxyUrl: string) => unknown
    Socks5ProxyAgent: new (proxyUrl: string) => unknown
}

const runtimeRequire = createRequire(__filename)

function loadImpit(): ImpitConstructor {
    const module = runtimeRequire('impit') as { Impit?: ImpitConstructor }
    if (!module.Impit) throw new Error('The impit HTTP transport is unavailable on this platform')
    return module.Impit
}

function createFetchTransport(timeout: number, proxyUrl?: string): HttpTransport {
    let fetchImpl: FetchTransportModule['fetch'] = globalThis.fetch
    let dispatcher: unknown

    if (proxyUrl) {
        const { fetch, ProxyAgent, Socks5ProxyAgent } = runtimeRequire('undici') as FetchTransportModule
        const protocol = new URL(proxyUrl).protocol.toLowerCase()
        if (protocol === 'socks4:') {
            throw new Error('Termux HTTP query transport does not support SOCKS4 proxies; use HTTP(S) or SOCKS5')
        }
        if (protocol === 'socks5:') {
            dispatcher = new Socks5ProxyAgent(proxyUrl)
        } else if (protocol === 'http:' || protocol === 'https:') {
            dispatcher = new ProxyAgent(proxyUrl)
        } else {
            throw new Error(`Unsupported Termux HTTP proxy protocol: ${protocol}`)
        }
        fetchImpl = fetch
    }

    return {
        async fetch(resource, init = {}) {
            const requestInit = init as ImpitRequestInit & { timeout?: number }
            const requestTimeout = requestInit.timeout ?? timeout
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), requestTimeout)

            try {
                const fetchInit = { ...requestInit }
                delete (fetchInit as { timeout?: number }).timeout
                const response = await fetchImpl(resource, {
                    ...(fetchInit as RequestInit),
                    ...(dispatcher ? { dispatcher } : {}),
                    signal: controller.signal
                })
                return response as unknown as ImpitResponse
            } finally {
                clearTimeout(timer)
            }
        }
    }
}

export function createHttpTransport(
    timeout: number,
    proxyUrl?: string,
    useFetchTransport = isTermuxRuntime
): HttpTransport {
    if (useFetchTransport) return createFetchTransport(timeout, proxyUrl)
    const Impit = loadImpit()
    return new Impit({ browser: 'chrome', ...(proxyUrl ? { proxyUrl } : {}), timeout })
}
