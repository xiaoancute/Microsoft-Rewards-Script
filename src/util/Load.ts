import type { Cookie } from 'patchright'
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'
import fs from 'fs'
import path from 'path'

import type { Account, ConfigSaveFingerprint } from '../interface/Account'
import type { Config } from '../interface/Config'
import { validateAccounts, validateConfig } from './Validator'

const runtimePaths = require('../../runtime-paths.cjs') as {
    findProjectRoot(startDir: string): string
    getAccountsCandidatePaths(projectRoot: string, isDev?: boolean): string[]
    getConfigCandidatePaths(projectRoot: string): string[]
    getCanonicalSessionDir(projectRoot: string, sessionPath: string, email: string): string
    getSessionCandidateDirs(projectRoot: string, sessionPath: string, email: string): string[]
}

let configCache: Config
let projectRootCache: string

function getProjectRoot(): string {
    if (!projectRootCache) {
        projectRootCache = runtimePaths.findProjectRoot(path.resolve(__dirname, '..'))
    }
    return projectRootCache
}

function readFirstExistingJson<T>(possiblePaths: string[]): { data: T; path: string } {
    for (const filePath of possiblePaths) {
        if (!fs.existsSync(filePath)) {
            continue
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        return {
            data: JSON.parse(content) as T,
            path: filePath
        }
    }

    throw new Error(`找不到可用文件: ${possiblePaths.join(', ')}`)
}

async function readFirstExistingJsonAsync<T>(possiblePaths: string[]): Promise<T | null> {
    for (const filePath of possiblePaths) {
        if (!fs.existsSync(filePath)) {
            continue
        }

        const content = await fs.promises.readFile(filePath, 'utf-8')
        return JSON.parse(content) as T
    }

    return null
}

export function loadAccounts(): Account[] {
    try {
        const projectRoot = getProjectRoot()
        const isDev = process.argv.includes('-dev')
        const { data: accountsData } = readFirstExistingJson<Account[]>(
            runtimePaths
                .getAccountsCandidatePaths(projectRoot, isDev)
                .filter((filePath: string) => !filePath.endsWith('accounts.example.json'))
        )

        validateAccounts(accountsData)

        return accountsData
    } catch (error) {
        throw new Error(error as string)
    }
}

export function loadConfig(): Config {
    try {
        if (configCache) {
            return configCache
        }

        const projectRoot = getProjectRoot()
        const { data: configData } = readFirstExistingJson<Config>(runtimePaths.getConfigCandidatePaths(projectRoot))
        validateConfig(configData)

        configCache = configData

        return configData
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function loadSessionData(
    sessionPath: string,
    email: string,
    saveFingerprint: ConfigSaveFingerprint,
    isMobile: boolean
) {
    try {
        const projectRoot = getProjectRoot()
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json'
        const sessionDirs = runtimePaths.getSessionCandidateDirs(projectRoot, sessionPath, email)
        const cookieFiles = sessionDirs.map(dir => path.join(dir, cookiesFileName))
        const cookies = (await readFirstExistingJsonAsync<Cookie[]>(cookieFiles)) ?? []

        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json'

        let fingerprint: BrowserFingerprintWithHeaders | undefined
        const shouldLoadFingerprint = isMobile ? saveFingerprint.mobile : saveFingerprint.desktop
        if (shouldLoadFingerprint) {
            const fingerprintFiles = sessionDirs.map(dir => path.join(dir, fingerprintFileName))
            const loadedFingerprint = await readFirstExistingJsonAsync<BrowserFingerprintWithHeaders>(fingerprintFiles)
            if (loadedFingerprint) {
                fingerprint = loadedFingerprint
            }
        }

        return {
            cookies: cookies,
            fingerprint: fingerprint
        }
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function saveSessionData(
    sessionPath: string,
    cookies: Cookie[],
    email: string,
    isMobile: boolean
): Promise<string> {
    try {
        const projectRoot = getProjectRoot()
        const sessionDir = runtimePaths.getCanonicalSessionDir(projectRoot, sessionPath, email)
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json'

        if (!fs.existsSync(sessionDir)) {
            await fs.promises.mkdir(sessionDir, { recursive: true })
        }

        await fs.promises.writeFile(path.join(sessionDir, cookiesFileName), JSON.stringify(cookies))

        return sessionDir
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function saveFingerprintData(
    sessionPath: string,
    email: string,
    isMobile: boolean,
    fingerpint: BrowserFingerprintWithHeaders
): Promise<string> {
    try {
        const projectRoot = getProjectRoot()
        const sessionDir = runtimePaths.getCanonicalSessionDir(projectRoot, sessionPath, email)
        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json'

        if (!fs.existsSync(sessionDir)) {
            await fs.promises.mkdir(sessionDir, { recursive: true })
        }

        await fs.promises.writeFile(path.join(sessionDir, fingerprintFileName), JSON.stringify(fingerpint))

        return sessionDir
    } catch (error) {
        throw new Error(error as string)
    }
}
