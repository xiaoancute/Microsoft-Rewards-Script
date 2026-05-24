export function externalRunLabel(externalRun) {
    if (externalRun?.source === 'local-run-lock') return '本地脚本'
    if (externalRun?.source === 'docker-lockfile') return '容器任务'
    return '外部任务'
}

export function hasLoggedInSession(sessions = []) {
    return sessions.some(session =>
        Boolean(
            session?.isLoggedIn ||
            Number(session?.desktop?.cookies || 0) > 0 ||
            Number(session?.mobile?.cookies || 0) > 0
        )
    )
}

export function describeRunUiState({ jobs = [], externalRun = null, capabilities = {}, formatTime = null } = {}) {
    const running = jobs.find(job => job?.running && job.kind === 'start') || null
    if (running) {
        const started = formatTime && running.startedAt ? ` · ${formatTime(running.startedAt)} 开始` : ''
        return {
            kind: 'running',
            runningJob: running,
            startDisabled: true,
            stopVisible: true,
            stopJobId: String(running.id),
            homeStateText: '运行中',
            homeSubText: `任务 #${running.id}${started}`,
            logPillText: `运行中 · 任务 #${running.id}`
        }
    }

    if (externalRun?.active) {
        const label = externalRunLabel(externalRun)
        return {
            kind: 'external',
            externalLabel: label,
            startDisabled: true,
            stopVisible: false,
            homeStateText: '运行中',
            homeSubText: `${label}运行中${externalRun.pid ? ` · PID ${externalRun.pid}` : ''}`,
            logPillText: `运行中 · ${label}`
        }
    }

    return {
        kind: 'idle',
        startDisabled: !capabilities.canRunNow,
        stopVisible: false,
        homeStateText: '空闲',
        homeSubText: '',
        logPillText: capabilities.canRunNow ? '空闲' : '当前环境不支持立即运行'
    }
}
