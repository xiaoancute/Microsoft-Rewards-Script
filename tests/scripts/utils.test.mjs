import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { loadAccounts, loadConfig } from '../../scripts/utils.js'

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-utils-'))
}

function minimalConfig(baseURL) {
    return {
        baseURL,
        sessionPath: 'sessions',
        headless: false,
        workers: {
            doDailySet: true
        }
    }
}

test('loadConfig prefers src/config.json over dist/config.json', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'dist'), { recursive: true })

    await fs.writeFile(path.join(projectRoot, 'src', 'config.json'), JSON.stringify(minimalConfig('src-config')))
    await fs.writeFile(path.join(projectRoot, 'dist', 'config.json'), JSON.stringify(minimalConfig('dist-config')))

    const result = loadConfig(projectRoot)

    assert.equal(result.data.baseURL, 'src-config')
    assert.equal(result.path, path.join(projectRoot, 'src', 'config.json'))
})

test('loadAccounts prefers src/accounts.json over dist/accounts.json', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'dist'), { recursive: true })

    await fs.writeFile(path.join(projectRoot, 'src', 'accounts.json'), JSON.stringify([{ email: 'src@example.com' }]))
    await fs.writeFile(path.join(projectRoot, 'dist', 'accounts.json'), JSON.stringify([{ email: 'dist@example.com' }]))

    const result = loadAccounts(projectRoot)

    assert.equal(result.data[0].email, 'src@example.com')
    assert.equal(result.path, path.join(projectRoot, 'src', 'accounts.json'))
})
