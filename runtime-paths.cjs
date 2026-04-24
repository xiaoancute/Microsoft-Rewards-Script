const fs = require('fs')
const path = require('path')

function findProjectRoot(startDir) {
    let dir = path.resolve(startDir)
    while (dir !== path.parse(dir).root) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
            return dir
        }
        dir = path.dirname(dir)
    }
    throw new Error('找不到项目根目录 (未找到 package.json)')
}

function getConfigDir(projectRoot) {
    return path.join(projectRoot, 'config')
}

function getCanonicalConfigPath(projectRoot) {
    return path.join(getConfigDir(projectRoot), 'config.json')
}

function getCanonicalAccountsPath(projectRoot, isDev = false) {
    return path.join(getConfigDir(projectRoot), isDev ? 'accounts.dev.json' : 'accounts.json')
}

function getConfigExamplePath(projectRoot) {
    return path.join(projectRoot, 'src', 'config.example.json')
}

function getAccountsExamplePath(projectRoot) {
    return path.join(projectRoot, 'src', 'accounts.example.json')
}

function getConfigCandidatePaths(projectRoot) {
    return [
        getCanonicalConfigPath(projectRoot),
        path.join(projectRoot, 'src', 'config.json'),
        path.join(projectRoot, 'dist', 'config.json'),
        path.join(projectRoot, 'config.json'),
        getConfigExamplePath(projectRoot)
    ]
}

function getAccountsCandidatePaths(projectRoot, isDev = false) {
    const base = [getCanonicalAccountsPath(projectRoot, isDev)]

    if (isDev) {
        base.push(getCanonicalAccountsPath(projectRoot, false))
        base.push(path.join(projectRoot, 'src', 'accounts.dev.json'))
    }

    base.push(
        path.join(projectRoot, 'src', 'accounts.json'),
        path.join(projectRoot, 'dist', 'accounts.json'),
        path.join(projectRoot, isDev ? 'accounts.dev.json' : 'accounts.json')
    )

    if (isDev) {
        base.push(path.join(projectRoot, 'accounts.json'))
    }

    base.push(getAccountsExamplePath(projectRoot))
    return base
}

function getCanonicalSessionRoot(projectRoot, sessionPath) {
    return path.join(projectRoot, sessionPath)
}

function getCanonicalSessionDir(projectRoot, sessionPath, email) {
    return path.join(getCanonicalSessionRoot(projectRoot, sessionPath), email)
}

function getLegacySessionDirs(projectRoot, sessionPath, email) {
    return [
        path.join(projectRoot, 'src', 'browser', sessionPath, email),
        path.join(projectRoot, 'dist', 'browser', sessionPath, email)
    ]
}

function getSessionCandidateDirs(projectRoot, sessionPath, email) {
    return [getCanonicalSessionDir(projectRoot, sessionPath, email), ...getLegacySessionDirs(projectRoot, sessionPath, email)]
}

function getSessionRootCandidates(projectRoot, sessionPath) {
    return [
        getCanonicalSessionRoot(projectRoot, sessionPath),
        path.join(projectRoot, 'src', 'browser', sessionPath),
        path.join(projectRoot, 'dist', 'browser', sessionPath)
    ]
}

module.exports = {
    findProjectRoot,
    getConfigDir,
    getCanonicalConfigPath,
    getCanonicalAccountsPath,
    getConfigExamplePath,
    getAccountsExamplePath,
    getConfigCandidatePaths,
    getAccountsCandidatePaths,
    getCanonicalSessionRoot,
    getCanonicalSessionDir,
    getLegacySessionDirs,
    getSessionCandidateDirs,
    getSessionRootCandidates
}
