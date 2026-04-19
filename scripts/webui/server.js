import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { createRunner } from './runner.js'
import {
    findProjectRoot,
    listAccounts,
    addAccount,
    updateAccount,
    removeAccount,
    listSessions,
    removeOneSession,
    removeAllSessions,
    getConfig,
    saveConfig,
    getStatus
} from './api.js'
import { diagnoseEnvironment, fixActionsFor } from './env.js'
import {
    getSystemdStatus,
    installRewardTimer,
    uninstallRewardTimer,
    updateRewardSchedule,
    triggerRewardNow,
    rewardServiceLogs,
    installWebuiAutostart,
    uninstallWebuiAutostart,
    lingerStatus
} from './systemd.js'
import {
    listLogFiles,
    readLogFile,
    streamLogFile,
    deleteLogFile,
    deleteAllLogFiles
} from './logstore.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = findProjectRoot(__dirname)

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function parseCliArgs(argv) {
    const out = {}
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--host' || a === '-H') out.host = argv[++i]
        else if (a === '--port' || a === '-p') out.port = Number(argv[++i])
        else if (a === '--help' || a === '-h') out.help = true
    }
    return out
}

const cli = parseCliArgs(process.argv.slice(2))
if (cli.help) {
    console.log(`Microsoft Rewards 管理页
用法: node scripts/webui/server.js [--host HOST] [--port PORT]
环境变量:
  WEBUI_HOST    监听地址 (默认 127.0.0.1)
  WEBUI_PORT    监听端口 (默认 3000)
  WEBUI_TOKEN   若设置则启用 Bearer 鉴权
`)
    process.exit(0)
}

const HOST = cli.host || process.env.WEBUI_HOST || '127.0.0.1'
const PORT = cli.port || Number(process.env.WEBUI_PORT) || 3000
const TOKEN = process.env.WEBUI_TOKEN || ''

const runner = createRunner(projectRoot)

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
    const data = JSON.stringify(body)
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data),
        'Cache-Control': 'no-store'
    })
    res.end(data)
}

function sendError(res, err) {
    const status = Number(err?.status) || 500
    const msg = err?.message || String(err)
    sendJson(res, status, { error: msg, code: err?.code })
}

async function readJsonBody(req, limit = 1 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', c => {
            size += c.length
            if (size > limit) {
                reject(Object.assign(new Error('请求体过大'), { status: 413 }))
                req.destroy()
                return
            }
            chunks.push(c)
        })
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            if (raw.length === 0) return resolve({})
            try {
                resolve(JSON.parse(raw))
            } catch (e) {
                reject(Object.assign(new Error('JSON 解析失败'), { status: 400 }))
            }
        })
        req.on('error', reject)
    })
}

function isLocalRequest(req) {
    const remote = req.socket.remoteAddress || ''
    return (
        remote === '127.0.0.1' ||
        remote === '::1' ||
        remote === '::ffff:127.0.0.1'
    )
}

function authorize(req, res) {
    if (TOKEN) {
        const header = req.headers['authorization'] || ''
        const m = header.match(/^Bearer\s+(.+)$/)
        if (!m || m[1] !== TOKEN) {
            sendJson(res, 401, { error: '未授权，需要正确的 Bearer token' })
            return false
        }
        return true
    }
    if (!isLocalRequest(req)) {
        sendJson(res, 403, {
            error: '默认仅允许本机访问。要开放远程请设置 WEBUI_TOKEN 后通过 Bearer 鉴权。'
        })
        return false
    }
    return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Static file serving (public/*)
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_DIR = path.join(__dirname, 'public')
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
}

function serveStatic(req, res, urlPath) {
    let relative = urlPath === '/' ? '/index.html' : urlPath
    // Strip query/hash already handled by URL parser; still protect against ..
    relative = relative.split('?')[0].split('#')[0]
    const target = path.join(PUBLIC_DIR, relative)
    if (!target.startsWith(PUBLIC_DIR)) {
        sendJson(res, 400, { error: '非法路径' })
        return
    }
    fs.stat(target, (err, stat) => {
        if (err || !stat.isFile()) {
            sendJson(res, 404, { error: '未找到' })
            return
        }
        const ext = path.extname(target).toLowerCase()
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'no-store'
        })
        fs.createReadStream(target).pipe(res)
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

async function handleApi(req, res, url) {
    const { pathname, searchParams } = url
    const method = req.method || 'GET'

    // GET /api/status
    if (method === 'GET' && pathname === '/api/status') {
        return sendJson(res, 200, getStatus(projectRoot, runner))
    }

    // Accounts
    if (method === 'GET' && pathname === '/api/accounts') {
        return sendJson(res, 200, { accounts: listAccounts(projectRoot) })
    }
    if (method === 'POST' && pathname === '/api/accounts') {
        const body = await readJsonBody(req)
        const created = await addAccount(projectRoot, body)
        return sendJson(res, 201, { account: created })
    }
    const mAccount = pathname.match(/^\/api\/accounts\/([^/]+)$/)
    if (mAccount) {
        const email = decodeURIComponent(mAccount[1])
        if (method === 'PUT') {
            const body = await readJsonBody(req)
            const updated = await updateAccount(projectRoot, email, body)
            return sendJson(res, 200, { account: updated })
        }
        if (method === 'DELETE') {
            await removeAccount(projectRoot, email)
            return sendJson(res, 200, { email })
        }
    }

    // Sessions
    if (method === 'GET' && pathname === '/api/sessions') {
        const sessions = await listSessions(projectRoot)
        return sendJson(res, 200, { sessions })
    }
    if (method === 'DELETE' && pathname === '/api/sessions') {
        return sendJson(res, 200, removeAllSessions(projectRoot))
    }
    const mSessOpen = pathname.match(/^\/api\/sessions\/([^/]+)\/open$/)
    if (method === 'POST' && mSessOpen) {
        const email = decodeURIComponent(mSessOpen[1])
        const body = await readJsonBody(req).catch(() => ({}))
        const job = runner.openBrowserSession(email, { dev: Boolean(body?.dev) })
        return sendJson(res, 201, { jobId: job.id, email })
    }
    const mSess = pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (method === 'DELETE' && mSess) {
        const email = decodeURIComponent(mSess[1])
        return sendJson(res, 200, removeOneSession(projectRoot, email))
    }

    // Config
    if (method === 'GET' && pathname === '/api/config') {
        return sendJson(res, 200, { config: getConfig(projectRoot) })
    }
    if (method === 'PUT' && pathname === '/api/config') {
        const body = await readJsonBody(req)
        const next = body?.config
        if (!next) throw Object.assign(new Error('缺少 config'), { status: 400 })
        const saved = await saveConfig(projectRoot, next)
        return sendJson(res, 200, { config: saved })
    }

    // Run control
    if (method === 'POST' && pathname === '/api/run/start') {
        const job = runner.startStart()
        return sendJson(res, 201, { jobId: job.id })
    }
    if (method === 'POST' && pathname === '/api/build') {
        const job = runner.startBuild()
        return sendJson(res, 201, { jobId: job.id })
    }
    const mStop = pathname.match(/^\/api\/jobs\/(\d+)\/stop$/)
    if (method === 'POST' && mStop) {
        await runner.stopJob(mStop[1])
        return sendJson(res, 200, { stopped: Number(mStop[1]) })
    }

    // Logs
    if (method === 'GET' && pathname === '/api/logs') {
        const jobId = Number(searchParams.get('jobId'))
        const tail = Number(searchParams.get('tail')) || 500
        return sendJson(res, 200, { lines: runner.getLogs(jobId, { tail }) })
    }
    if (method === 'GET' && pathname === '/api/logs/stream') {
        return streamLogs(req, res, searchParams)
    }
    if (method === 'GET' && pathname === '/api/jobs') {
        return sendJson(res, 200, { jobs: runner.snapshot() })
    }

    // Environment diagnostics
    if (method === 'GET' && pathname === '/api/env') {
        const diag = diagnoseEnvironment(projectRoot)
        const actions = fixActionsFor(diag.platform.distroId)
        const actionList = Object.entries(actions).map(([id, spec]) => ({ id, label: spec.label }))
        return sendJson(res, 200, { ...diag, actions: actionList })
    }
    const mFix = pathname.match(/^\/api\/env\/fix\/([\w-]+)$/)
    if (method === 'POST' && mFix) {
        const id = mFix[1]
        const diag = diagnoseEnvironment(projectRoot)
        const actions = fixActionsFor(diag.platform.distroId)
        const spec = actions[id]
        if (!spec) throw Object.assign(new Error(`未定义的修复动作: ${id}`), { status: 400 })
        const job = runner.spawnJob({
            kind: `fix:${id}`,
            label: spec.label,
            command: spec.command,
            args: spec.args
        })
        return sendJson(res, 201, { jobId: job.id, label: spec.label })
    }

    // Log history (per-day files written by Logger.ts)
    if (method === 'GET' && pathname === '/api/log-files') {
        return sendJson(res, 200, listLogFiles(projectRoot))
    }
    const mLogFile = pathname.match(/^\/api\/log-files\/([^/]+)$/)
    if (method === 'GET' && mLogFile) {
        if (searchParams.get('download') === '1') {
            const { file, stat } = streamLogFile(projectRoot, decodeURIComponent(mLogFile[1]))
            res.writeHead(200, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Length': stat.size,
                'Content-Disposition': `attachment; filename="${path.basename(file)}"`
            })
            fs.createReadStream(file).pipe(res)
            return
        }
        const tail = Number(searchParams.get('tailBytes')) || undefined
        return sendJson(res, 200, readLogFile(projectRoot, decodeURIComponent(mLogFile[1]), { tailBytes: tail }))
    }
    if (method === 'DELETE' && mLogFile) {
        return sendJson(res, 200, deleteLogFile(projectRoot, decodeURIComponent(mLogFile[1])))
    }
    if (method === 'DELETE' && pathname === '/api/log-files') {
        return sendJson(res, 200, deleteAllLogFiles(projectRoot))
    }

    // systemd (Linux user units)
    if (method === 'GET' && pathname === '/api/systemd') {
        const [status, linger] = await Promise.all([getSystemdStatus(), lingerStatus()])
        return sendJson(res, 200, { ...status, linger: linger.linger })
    }
    if (method === 'POST' && pathname === '/api/systemd/install') {
        const body = await readJsonBody(req).catch(() => ({}))
        return sendJson(res, 200, await installRewardTimer(projectRoot, { onCalendar: body?.onCalendar }))
    }
    if (method === 'POST' && pathname === '/api/systemd/uninstall') {
        return sendJson(res, 200, await uninstallRewardTimer())
    }
    if (method === 'PUT' && pathname === '/api/systemd/schedule') {
        const body = await readJsonBody(req)
        return sendJson(res, 200, await updateRewardSchedule(body?.onCalendar))
    }
    if (method === 'POST' && pathname === '/api/systemd/trigger') {
        return sendJson(res, 200, await triggerRewardNow())
    }
    if (method === 'GET' && pathname === '/api/systemd/journal') {
        const n = Number(searchParams.get('lines')) || 200
        return sendJson(res, 200, await rewardServiceLogs(n))
    }
    if (method === 'POST' && pathname === '/api/systemd/webui/install') {
        const body = await readJsonBody(req).catch(() => ({}))
        return sendJson(
            res,
            200,
            await installWebuiAutostart(projectRoot, {
                host: body?.host || HOST,
                port: body?.port || PORT,
                token: body?.token ?? TOKEN
            })
        )
    }
    if (method === 'POST' && pathname === '/api/systemd/webui/uninstall') {
        return sendJson(res, 200, await uninstallWebuiAutostart())
    }

    sendJson(res, 404, { error: `未定义路由 ${method} ${pathname}` })
}

function streamLogs(req, res, searchParams) {
    const filterJobId = searchParams.get('jobId') ? Number(searchParams.get('jobId')) : null

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
    })

    const send = payload => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    // Replay recent buffer for the requested job (if any)
    if (filterJobId) {
        for (const entry of runner.getLogs(filterJobId, { tail: 200 })) {
            send({ kind: 'line', jobId: filterJobId, ...entry })
        }
    }

    const onLine = entry => {
        if (filterJobId && entry.jobId !== filterJobId) return
        send({ kind: 'line', ...entry })
    }
    const onExit = info => {
        if (filterJobId && info.jobId !== filterJobId) return
        send({ kind: 'exit', ...info })
    }
    runner.on('line', onLine)
    runner.on('exit', onExit)

    const heartbeat = setInterval(() => {
        res.write(': ping\n\n')
    }, 15000)

    req.on('close', () => {
        clearInterval(heartbeat)
        runner.off('line', onLine)
        runner.off('exit', onExit)
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

        if (url.pathname.startsWith('/api/')) {
            if (!authorize(req, res)) return
            await handleApi(req, res, url)
            return
        }

        // Non-API: also protect so token-only deploy can't leak static pages
        if (!authorize(req, res)) return
        serveStatic(req, res, url.pathname)
    } catch (err) {
        sendError(res, err)
    }
})

server.on('error', err => {
    console.error(`[webui] 服务器错误: ${err.message}`)
    process.exit(1)
})

server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? '127.0.0.1 (或局域网 IP)' : HOST
    console.log(`[webui] 管理页已启动: http://${displayHost}:${PORT}`)
    if (!TOKEN && HOST !== '127.0.0.1' && HOST !== '::1') {
        console.warn(
            '[webui] ⚠️  监听非本机地址但未设置 WEBUI_TOKEN，远程请求会被拒绝 (403)。设 WEBUI_TOKEN=xxx 开启鉴权。'
        )
    }
})

const gracefulShutdown = signal => () => {
    console.log(`[webui] 收到 ${signal}，关闭中...`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 3000).unref()
}
process.on('SIGINT', gracefulShutdown('SIGINT'))
process.on('SIGTERM', gracefulShutdown('SIGTERM'))
