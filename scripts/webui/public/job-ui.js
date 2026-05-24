export function formatCurrentLogSourceLabel(job) {
    if (!job) return '当前任务日志'

    const status = job?.running
        ? '运行中'
        : Number(job?.exitCode) === 0
            ? '已完成'
            : '异常退出'
    return `${job?.label || '后台任务'} · ${status}`
}

export function chooseLogJobId(jobs) {
    const list = Array.isArray(jobs) ? jobs : []
    const running = list.find(job => job.running)
    if (running) return String(running.id)

    const latest = list[list.length - 1]
    return latest ? String(latest.id) : ''
}
