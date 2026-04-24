import path from 'path'
import fs from 'fs'
import { getDirname, getProjectRoot, log, loadConfig, getSessionRootPaths, safeRemoveDirectory } from '../utils.js'

const __dirname = getDirname(import.meta.url)
const projectRoot = getProjectRoot(__dirname)

log('DEBUG', '项目根目录:', projectRoot)
log('DEBUG', '正在搜索 config.json...')

const configResult = loadConfig(projectRoot)
const config = configResult.data
const configPath = configResult.path

log('INFO', '使用配置:', configPath)

if (!config.sessionPath) {
    log('ERROR', '无效的 config.json - 缺少必需字段: sessionPath')
    log('ERROR', `配置文件: ${configPath}`)
    process.exit(1)
}

log('INFO', '来自配置的会话路径:', config.sessionPath)

const configDir = path.dirname(configPath)
const possibleSessionDirs = getSessionRootPaths(projectRoot, config.sessionPath)

log('DEBUG', '正在搜索会话目录...')

let foundAny = false
for (const p of possibleSessionDirs) {
    log('DEBUG', '检查:', p)
    if (fs.existsSync(p)) {
        foundAny = true
        log('DEBUG', '在以下位置找到会话目录:', p)
    }
}

if (!foundAny) {
    log('DEBUG', '未找到现有会话目录，仍将使用规范目录作为清理目标:', path.resolve(configDir, config.sessionPath))
}

let success = true
for (const sessionDir of possibleSessionDirs) {
    success = safeRemoveDirectory(sessionDir, projectRoot) && success
}

if (!success) {
    process.exit(1)
}

log('INFO', '完成.')
