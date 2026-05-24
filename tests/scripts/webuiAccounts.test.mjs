import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { addAccount, listAccounts, updateAccount } from '../../scripts/webui/api.js'

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-webui-accounts-'))
}

test('webui accounts API preserves the enabled account flag', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'src', 'accounts.example.json'), '[]')

    await addAccount(projectRoot, {
        email: 'toggle@example.com',
        password: 'secret',
        enabled: false
    })

    let accounts = listAccounts(projectRoot)
    assert.equal(accounts[0].enabled, false)

    await updateAccount(projectRoot, 'toggle@example.com', { enabled: true })

    accounts = listAccounts(projectRoot)
    assert.equal(accounts[0].enabled, true)
})
