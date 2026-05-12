import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
    pruneRuntimeData,
    resolveDockerLockFile
} from '../../scripts/docker/runtime-maintenance.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-docker-hardening-'))
}

test('resolveDockerLockFile scopes the lock file by instance id and respects overrides', () => {
    assert.equal(
        resolveDockerLockFile(
            {
                MRS_INSTANCE_ID: 'Prod Rewards / A'
            },
            { tmpDir: '/tmp' }
        ),
        '/tmp/run_daily-prod-rewards-a.lock'
    )

    assert.equal(
        resolveDockerLockFile(
            {
                HOSTNAME: 'docker-container-123'
            },
            { tmpDir: '/tmp' }
        ),
        '/tmp/run_daily-docker-container-123.lock'
    )

    assert.equal(
        resolveDockerLockFile(
            {
                MRS_DOCKER_LOCKFILE: '/custom/run_daily.lock'
            },
            { tmpDir: '/tmp' }
        ),
        '/custom/run_daily.lock'
    )
})

test('pruneRuntimeData removes expired logs and trims old earnings report rows', async () => {
    const tempRoot = await makeProjectRoot()
    const logsDir = path.join(tempRoot, 'logs')
    const reportsDir = path.join(tempRoot, 'reports')
    const earningsFile = path.join(reportsDir, 'earnings.jsonl')

    await fs.mkdir(logsDir, { recursive: true })
    await fs.mkdir(reportsDir, { recursive: true })

    await fs.writeFile(path.join(logsDir, '2026-04-10.log'), 'old log\n')
    await fs.writeFile(path.join(logsDir, '2026-04-24.log'), 'recent log\n')
    await fs.writeFile(
        earningsFile,
        [
            JSON.stringify({
                startedAt: '2026-03-01T01:00:00.000Z',
                finishedAt: '2026-03-01T01:05:00.000Z',
                accounts: []
            }),
            'not-json-at-all',
            JSON.stringify({
                startedAt: '2026-04-24T01:00:00.000Z',
                finishedAt: '2026-04-24T01:05:00.000Z',
                accounts: []
            })
        ].join('\n') + '\n',
        'utf8'
    )

    const result = await pruneRuntimeData(tempRoot, {
        now: '2026-04-25T12:00:00.000Z',
        logRetentionDays: 7,
        reportRetentionDays: 30
    })

    assert.equal(result.logs.deleted, 1)
    assert.equal(result.logs.kept, 1)
    assert.equal(result.reports.deleted, 1)
    assert.equal(result.reports.kept, 2)

    const remainingLogs = await fs.readdir(logsDir)
    assert.deepEqual(remainingLogs.sort(), ['2026-04-24.log'])

    const remainingReportLines = (await fs.readFile(earningsFile, 'utf8'))
        .trim()
        .split('\n')
    assert.equal(remainingReportLines.length, 2)
    assert.equal(remainingReportLines[0], 'not-json-at-all')
    assert.match(remainingReportLines[1], /2026-04-24T01:00:00.000Z/)
})

test('compose and Dockerfile default to building this repo with runtime maintenance assets', async () => {
    const compose = await fs.readFile(path.join(projectRoot, 'compose.yaml'), 'utf8')
    const dockerfile = await fs.readFile(path.join(projectRoot, 'Dockerfile'), 'utf8')
    const entrypoint = await fs.readFile(path.join(projectRoot, 'scripts', 'docker', 'entrypoint.sh'), 'utf8')

    assert.match(compose, /\n\s+build:\s*\n\s+context:\s*\./)
    assert.doesNotMatch(compose, /ghcr\.io\/thenetsky\/microsoft-rewards-script:latest/)
    assert.match(compose, /LOG_RETENTION_DAYS:/)
    assert.match(compose, /REPORT_RETENTION_DAYS:/)
    assert.match(compose, /MRS_INSTANCE_ID:/)

    assert.match(dockerfile, /COPY --from=builder .*\/scripts\/docker \.\/scripts\/docker/)
    assert.match(entrypoint.split('\n')[0], /bash/)
})
