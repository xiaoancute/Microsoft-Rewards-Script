export function formatJobOptionLabel(job) {
    const status = job?.running
        ? '运行中'
        : Number(job?.exitCode) === 0
            ? '已完成'
            : '异常退出'
    return `#${job?.id} ${job?.label || '后台任务'} · ${status}`
}

export function chooseDefaultJobId(jobs, currentValue = '') {
    const list = Array.isArray(jobs) ? jobs : []
    if (currentValue && list.some(job => String(job.id) === String(currentValue))) {
        return String(currentValue)
    }

    const running = list.find(job => job.running)
    if (running) return String(running.id)

    const latest = list[list.length - 1]
    return latest ? String(latest.id) : ''
}
