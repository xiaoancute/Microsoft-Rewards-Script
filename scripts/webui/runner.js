import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'

const MAX_LOG_LINES = 2000
const STOP_TIMEOUT_MS = 5000

// One-shot jobs (npm start, npm run build) are singletons per job-kind. The
// per-email "open" job (a headed browser window for manual login) may run
// concurrently with others, but never twice for the same email.

class Job extends EventEmitter {
    constructor({ id, kind, label, proc }) {
        super()
        this.id = id
        this.kind = kind
        this.label = label
        this.proc = proc
        this.startedAt = Date.now()
        this.exitCode = null
        this.signal = null
        this.buffer = []
        this.stopping = false

        const onData = (chunk, stream) => {
            const text = chunk.toString('utf8')
            for (const rawLine of text.split(/\r?\n/)) {
                if (rawLine.length === 0) continue
                const entry = {
                    t: Date.now(),
                    stream,
                    line: rawLine
                }
                this.buffer.push(entry)
                if (this.buffer.length > MAX_LOG_LINES) {
                    this.buffer.shift()
                }
                this.emit('line', entry)
            }
        }
        proc.stdout?.on('data', c => onData(c, 'stdout'))
        proc.stderr?.on('data', c => onData(c, 'stderr'))

        proc.on('exit', (code, signal) => {
            this.exitCode = code
            this.signal = signal
            this.emit('exit', { code, signal })
        })
        proc.on('error', err => {
            this.emit('line', {
                t: Date.now(),
                stream: 'stderr',
                line: `[runner] 进程错误: ${err.message}`
            })
        })
    }

    isRunning() {
        return this.exitCode === null && this.signal === null
    }

    async stop() {
        if (!this.isRunning()) return
        this.stopping = true
        this.proc.kill('SIGTERM')
        await new Promise(resolve => {
            const timer = setTimeout(() => {
                if (this.isRunning()) {
                    try {
                        this.proc.kill('SIGKILL')
                    } catch {}
                }
                resolve()
            }, STOP_TIMEOUT_MS)
            this.proc.once('exit', () => {
                clearTimeout(timer)
                resolve()
            })
        })
    }

    snapshot() {
        return {
            id: this.id,
            kind: this.kind,
            label: this.label,
            startedAt: this.startedAt,
            exitCode: this.exitCode,
            signal: this.signal,
            running: this.isRunning(),
            bufferedLines: this.buffer.length
        }
    }
}

export class Runner extends EventEmitter {
    constructor(projectRoot) {
        super()
        this.projectRoot = projectRoot
        this.jobs = new Map() // id → Job
        this.nextId = 1
    }

    snapshot() {
        return Array.from(this.jobs.values()).map(j => j.snapshot())
    }

    getJob(id) {
        return this.jobs.get(id)
    }

    hasRunning(kind) {
        for (const job of this.jobs.values()) {
            if (job.isRunning() && job.kind === kind) return job
        }
        return null
    }

    hasOpenFor(email) {
        for (const job of this.jobs.values()) {
            if (job.isRunning() && job.kind === 'open' && job.label === email) return job
        }
        return null
    }

    spawnJob({ kind, label, command, args, env }) {
        const proc = spawn(command, args, {
            cwd: this.projectRoot,
            env: { ...process.env, ...(env || {}) },
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false
        })
        const id = this.nextId++
        const job = new Job({ id, kind, label: label || kind, proc })
        this.jobs.set(id, job)

        job.on('line', entry => this.emit('line', { jobId: id, ...entry }))
        job.on('exit', info => this.emit('exit', { jobId: id, ...info }))

        // Trim history: keep last 20 finished + all running
        if (this.jobs.size > 40) {
            const finished = Array.from(this.jobs.values()).filter(j => !j.isRunning())
            finished.sort((a, b) => a.startedAt - b.startedAt)
            const toDrop = finished.slice(0, finished.length - 20)
            for (const j of toDrop) this.jobs.delete(j.id)
        }
        return job
    }

    startNpm(script, { label } = {}) {
        const existing = this.hasRunning(script)
        if (existing) {
            const err = new Error(`${script} 已在运行中 (id=${existing.id})`)
            err.code = 'ALREADY_RUNNING'
            err.status = 409
            throw err
        }
        // Use `npm run <script>` for non-lifecycle names, and `npm <script>` for start/build/etc
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
        const args = ['run', script]
        return this.spawnJob({
            kind: script,
            label: label || `npm run ${script}`,
            command: npmCmd,
            args
        })
    }

    startStart() {
        const existing = this.hasRunning('start')
        if (existing) {
            const err = new Error(`npm start 已在运行中 (id=${existing.id})`)
            err.code = 'ALREADY_RUNNING'
            err.status = 409
            throw err
        }
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
        return this.spawnJob({
            kind: 'start',
            label: 'npm start',
            command: npmCmd,
            args: ['start']
        })
    }

    startBuild() {
        return this.startNpm('build', { label: 'npm run build' })
    }

    openBrowserSession(email, { dev = false } = {}) {
        if (!email || typeof email !== 'string' || !email.includes('@')) {
            const err = new Error('无效邮箱')
            err.status = 400
            throw err
        }
        if (/[/\\\0]|\.\./.test(email)) {
            const err = new Error(`邮箱包含非法字符: ${email}`)
            err.status = 400
            throw err
        }
        const existing = this.hasOpenFor(email)
        if (existing) {
            const err = new Error(`${email} 的浏览器窗口已经打开 (id=${existing.id})`)
            err.code = 'ALREADY_RUNNING'
            err.status = 409
            throw err
        }
        const script = path.join(this.projectRoot, 'scripts', 'main', 'browserSession.js')
        const args = [script, '-email', email]
        if (dev) args.push('-dev')
        return this.spawnJob({
            kind: 'open',
            label: email,
            command: process.execPath, // current node
            args
        })
    }

    stopJob(id) {
        const job = this.jobs.get(Number(id))
        if (!job) {
            const err = new Error(`未找到任务 ${id}`)
            err.status = 404
            throw err
        }
        return job.stop()
    }

    getLogs(id, { tail = MAX_LOG_LINES } = {}) {
        const job = this.jobs.get(Number(id))
        if (!job) return []
        const slice = job.buffer.slice(-Math.max(1, Math.min(tail, MAX_LOG_LINES)))
        return slice
    }
}

export function createRunner(projectRoot) {
    return new Runner(projectRoot)
}
