import fs from 'fs'
import path from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// logs/*.log 历史管理（由 src/logging/Logger.ts 写入）
// ─────────────────────────────────────────────────────────────────────────────

function logsDir(projectRoot) {
    return path.join(projectRoot, 'logs')
}

function assertSafeName(name) {
    if (!name || typeof name !== 'string') {
        throw Object.assign(new Error('缺少文件名'), { status: 400 })
    }
    if (!/^[\w.\-]+\.log$/.test(name)) {
        throw Object.assign(new Error(`非法文件名: ${name}`), { status: 400 })
    }
}

export function listLogFiles(projectRoot) {
    const dir = logsDir(projectRoot)
    if (!fs.existsSync(dir)) return { dir, files: [] }
    const files = []
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.log')) continue
        try {
            const stat = fs.statSync(path.join(dir, name))
            files.push({
                name,
                size: stat.size,
                mtime: stat.mtimeMs
            })
        } catch {}
    }
    files.sort((a, b) => b.mtime - a.mtime)
    return { dir, files }
}

export function readLogFile(projectRoot, name, { tailBytes = 256 * 1024 } = {}) {
    assertSafeName(name)
    const file = path.join(logsDir(projectRoot), name)
    if (!file.startsWith(logsDir(projectRoot))) {
        throw Object.assign(new Error('非法路径'), { status: 400 })
    }
    if (!fs.existsSync(file)) {
        throw Object.assign(new Error('文件不存在'), { status: 404 })
    }
    const stat = fs.statSync(file)
    const start = Math.max(0, stat.size - Math.max(1024, Math.min(tailBytes, 5 * 1024 * 1024)))
    const buf = Buffer.alloc(stat.size - start)
    const fd = fs.openSync(file, 'r')
    try {
        fs.readSync(fd, buf, 0, buf.length, start)
    } finally {
        fs.closeSync(fd)
    }
    return {
        name,
        size: stat.size,
        mtime: stat.mtimeMs,
        truncated: start > 0,
        content: buf.toString('utf8')
    }
}

export function streamLogFile(projectRoot, name) {
    assertSafeName(name)
    const file = path.join(logsDir(projectRoot), name)
    if (!fs.existsSync(file)) {
        throw Object.assign(new Error('文件不存在'), { status: 404 })
    }
    const stat = fs.statSync(file)
    return { file, stat }
}

export function deleteLogFile(projectRoot, name) {
    assertSafeName(name)
    const file = path.join(logsDir(projectRoot), name)
    if (!file.startsWith(logsDir(projectRoot))) {
        throw Object.assign(new Error('非法路径'), { status: 400 })
    }
    if (!fs.existsSync(file)) return { deleted: false }
    fs.unlinkSync(file)
    return { deleted: true, name }
}

export function deleteAllLogFiles(projectRoot) {
    const dir = logsDir(projectRoot)
    if (!fs.existsSync(dir)) return { deleted: 0 }
    let count = 0
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.log')) continue
        try {
            fs.unlinkSync(path.join(dir, name))
            count++
        } catch {}
    }
    return { deleted: count }
}
