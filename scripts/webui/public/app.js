// Frontend app — vanilla JS ESM, no bundler
// ─────────────────────────────────────────────────────────────────────────────

import { chooseLogJobId, formatCurrentLogSourceLabel } from './job-ui.js'
import { describeRunUiState, hasLoggedInSession } from './run-ui.js'

const TOKEN_KEY = 'webui_token'
const THEME_KEY = 'webui_theme'

// ─────────────────────────────────────────────────────────────────────────────
// Theme toggle (day / night)
// 初始 data-theme 已由 <head> 内联脚本设置，这里只处理点击切换
// ─────────────────────────────────────────────────────────────────────────────

function initThemeToggle() {
    const btn = document.getElementById('theme-toggle')
    if (!btn) return
    btn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
        const next = cur === 'dark' ? 'light' : 'dark'
        document.documentElement.setAttribute('data-theme', next)
        try { localStorage.setItem(THEME_KEY, next) } catch {}
    })
}

let state = {
    status: null,
    accounts: [],
    sessions: [],
    config: null,
    jobs: [],
    reports: null,
    activeJobId: null,
    sse: null,
    reportFilters: {
        range: '7d',
        account: 'all'
    },
    pendingAccountFocus: null
}

function currentRuntime() {
    return state.status?.runtime || {
        mode: 'local',
        isDocker: false,
        webuiEnabled: true
    }
}

function currentCapabilities() {
    return state.status?.capabilities || {
        canOpenBrowserSession: true,
        canManageSystemd: true,
        canBuildProject: true,
        canRunNow: true,
        canViewReports: true,
        canViewLogHistory: true
    }
}

function isDockerRuntime() {
    return Boolean(currentRuntime().isDocker)
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP wrapper with optional bearer token
// ─────────────────────────────────────────────────────────────────────────────

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || ''
}

function authHeaders(extra = {}) {
    const headers = { ...extra }
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    return headers
}

async function api(path, opts = {}) {
    const headers = authHeaders(opts.headers || {})
    if (opts.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
    }
    const res = await fetch(path, {
        ...opts,
        headers,
        body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
    })
    const ct = res.headers.get('content-type') || ''
    const body = ct.includes('application/json') ? await res.json() : await res.text()
    if (res.status === 401) {
        const input = prompt('此管理页需要 Bearer token，请粘贴:')
        if (input) {
            sessionStorage.setItem(TOKEN_KEY, input)
            return api(path, opts)
        }
        throw Object.assign(new Error('未授权'), { status: 401 })
    }
    if (!res.ok) {
        throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), {
            status: res.status,
            body
        })
    }
    return body
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────

function toast(msg, kind = '') {
    const el = document.createElement('div')
    el.className = `toast ${kind}`
    el.textContent = msg
    document.getElementById('toast-wrap').appendChild(el)
    setTimeout(() => el.remove(), 4500)
}

function setDisabled(button, disabled, title = '') {
    if (!button) return
    button.disabled = disabled
    if (disabled && title) button.title = title
    else button.removeAttribute('title')
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === name)
    })
    document.querySelectorAll('.panel').forEach(p => {
        p.classList.toggle('hidden', p.id !== `panel-${name}`)
    })
    // Re-fetch on tab open so user always sees fresh state
    if (name === 'home') loadDashboard()
    if (name === 'accounts') loadAccounts()
    if (name === 'reports') loadReports()
    if (name === 'sessions') loadSessions()
    if (name === 'config') loadConfig()
    if (name === 'logs') loadJobs({ autoSubscribe: true })
    if (name === 'env') loadEnv()
    if (name === 'schedule') loadSchedule()
    if (name === 'loghistory') loadLogHistory()
}

document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
})

// Dashboard "go to tab" buttons
document.querySelectorAll('[data-go-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goTab))
})

// ─────────────────────────────────────────────────────────────────────────────
// Home / status
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

async function loadDashboard() {
    try {
        const [status, env, sched, accounts] = await Promise.all([
            api('/api/status'),
            api('/api/env'),
            api('/api/systemd').catch(() => null),
            api('/api/accounts')
        ])
        const sessionsResult = await api('/api/sessions').catch(() => ({ sessions: state.sessions || [] }))
        state.status = status
        state.sessions = sessionsResult.sessions || []
        renderDashboard(status, env, sched, accounts.accounts || [], state.sessions)
        // Also refresh the topbar status
        document.getElementById('status-dot').className = 'dot ok'
        document.getElementById('status-text').textContent = `连接正常 · ${status.nodeVersion}`
    } catch (err) {
        document.getElementById('status-dot').className = 'dot err'
        document.getElementById('status-text').textContent = err.message
    }
}

function renderDashboard(status, env, sched, accounts, sessions = []) {
    const capabilities = status.capabilities || currentCapabilities()
    // Run card
    const runBig = document.getElementById('dash-run-state')
    const runSub = document.getElementById('dash-run-sub')
    const btnRunNow = document.getElementById('dash-run-now')
    const btnRunStop = document.getElementById('dash-run-stop')
    const runState = describeRunUiState({
        jobs: status.jobs || [],
        externalRun: status.externalRun,
        capabilities,
        formatTime: value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false })
    })

    if (runState.kind === 'running') {
        runBig.textContent = runState.homeStateText
        runBig.className = 'dash-big run'
        runSub.textContent = runState.homeSubText
        btnRunNow.classList.add('hidden')
        btnRunStop.classList.remove('hidden')
        btnRunStop.dataset.jobId = runState.stopJobId
        setDisabled(btnRunNow, false)
    } else if (runState.kind === 'external') {
        runBig.textContent = runState.homeStateText
        runBig.className = 'dash-big run'
        runSub.textContent = runState.homeSubText
        btnRunNow.classList.add('hidden')
        btnRunStop.classList.add('hidden')
    } else {
        runBig.textContent = runState.homeStateText
        runBig.className = 'dash-big'
        const lastFinished = (status.jobs || []).filter(j => !j.running && j.kind === 'start').pop()
        runSub.textContent = lastFinished
            ? `上次任务 #${lastFinished.id} · exit=${lastFinished.exitCode}`
            : '还没运行过'
        btnRunNow.classList.remove('hidden')
        btnRunStop.classList.add('hidden')
        setDisabled(btnRunNow, runState.startDisabled, capabilities.canRunNow ? '' : '当前环境不支持立即运行')
    }

    // Timer card
    const timerBig = document.getElementById('dash-timer-state')
    const timerSub = document.getElementById('dash-timer-sub')
    if (sched?.mode === 'docker') {
        if (sched.reward?.active) {
            timerBig.textContent = 'Docker 运行中'
            timerBig.className = 'dash-big ok'
        } else if (sched.reward?.enabled) {
            timerBig.textContent = 'Docker 已配置'
            timerBig.className = 'dash-big ok'
        } else {
            timerBig.textContent = 'Docker 未配置'
            timerBig.className = 'dash-big warn'
        }
        timerSub.textContent = `Cron: ${sched.reward?.onCalendar || '未设置'} · 启动即跑: ${sched.reward?.runOnStart ? '开' : '关'}`
    } else if (sched && sched.reward) {
        if (sched.reward.active) {
            timerBig.textContent = '已启用'
            timerBig.className = 'dash-big ok'
            timerSub.textContent = sched.reward.nextRun
                ? `下次: ${sched.reward.nextRun.split(/\s{2,}/)[0]}`
                : `表达式: ${sched.reward.onCalendar || '—'}`
        } else if (sched.reward.timerInstalled) {
            timerBig.textContent = '已安装未启用'
            timerBig.className = 'dash-big warn'
            timerSub.textContent = '到「定时」Tab 启用'
        } else {
            timerBig.textContent = '未安装'
            timerBig.className = 'dash-big'
            timerSub.textContent = 'Linux 下可一键安装'
        }
    } else {
        timerBig.textContent = '不可用'
        timerBig.className = 'dash-big'
        timerSub.textContent = '非 Linux 或 systemd --user 不可用'
    }

    // Account card
    document.getElementById('dash-account-count').textContent = accounts.length
    const loggedInSessions = sessions.filter(session =>
        hasLoggedInSession([session])
    ).length
    document.getElementById('dash-account-sub').textContent =
        accounts.length === 0
            ? '点「去添加」配置第一个账号'
            : `${loggedInSessions}/${accounts.length} 个账号已有登录 Session`

    // Env card
    const failed = (env.checks || []).filter(c => !c.ok)
    const envBig = document.getElementById('dash-env-state')
    const envSub = document.getElementById('dash-env-sub')
    if (failed.length === 0) {
        envBig.textContent = '一切正常'
        envBig.className = 'dash-big ok'
        envSub.textContent = `${env.checks.length} 项检查全部通过 · ${env.platform.distro}`
    } else {
        envBig.textContent = `${failed.length} 项待修`
        envBig.className = 'dash-big warn'
        envSub.textContent = failed.map(c => c.name).slice(0, 3).join(' · ')
    }

    // Quickstart steps
    const stepsEl = document.getElementById('dash-steps')
    const nodeOk = env.checks.find(c => c.name === 'Node.js')?.ok
    const chromiumOk = env.checks.find(c => c.name === 'Chromium 浏览器')?.ok
    const builtOk = env.checks.find(c => c.name === '项目已构建 (dist/)')?.ok
    const hasAccount = accounts.length > 0
    const anyLogin = hasAccount && hasLoggedInSession(sessions)
    const hasTimer = Boolean(sched?.reward?.active || sched?.reward?.enabled)
    const steps = isDockerRuntime()
        ? [
            { done: nodeOk && builtOk, text: '容器环境就绪 — 到「环境」Tab 看挂载与浏览器状态' },
            { done: hasAccount, text: '添加账号 — 到「账号」Tab' },
            { done: anyLogin, text: '首次登录：先在本地生成 session，再挂载到容器的 sessions/' },
            { done: false, text: '立即跑一轮 — 首页「▶ 立即运行」或到「运行日志」Tab' },
            { done: hasTimer, text: '检查 Docker 定时 — 到「定时」Tab 看 CRON_SCHEDULE / RUN_ON_START' }
        ]
        : [
            { done: nodeOk && chromiumOk && builtOk, text: '环境就绪（Node、Chromium、构建）— 到「环境」Tab' },
        { done: hasAccount, text: '添加账号 — 到「账号」Tab' },
        { done: anyLogin, text: '首次登录（弹浏览器）— 到「Session」Tab 点「打开浏览器」' },
        { done: false, text: '立即跑一轮 — 首页「▶ 立即运行」或到「运行日志」Tab' },
        { done: hasTimer, text: '启用每日定时 — 到「定时」Tab' }
    ]
    stepsEl.innerHTML = steps.map(s => `<li${s.done ? ' class="done"' : ''}>${escapeHtml(s.text)}</li>`).join('')
}

document.getElementById('btn-dash-refresh').addEventListener('click', loadDashboard)
document.getElementById('dash-run-now').addEventListener('click', async () => {
    try {
        const { jobId } = await api('/api/run/start', { method: 'POST', body: {} })
        toast(`已启动任务 #${jobId}`, 'ok')
        await loadDashboard()
        switchTab('logs')
        subscribeLogs(jobId)
    } catch (err) {
        toast(`启动失败: ${err.message}`, 'err')
    }
})
document.getElementById('dash-run-stop').addEventListener('click', async event => {
    const id = event.currentTarget.dataset.jobId
    if (!id) return
    if (!confirm(`确认停止任务 #${id}？`)) return
    try {
        await api(`/api/jobs/${id}/stop`, { method: 'POST', body: {} })
        toast('已停止', 'ok')
        loadDashboard()
    } catch (err) {
        toast(`停止失败: ${err.message}`, 'err')
    }
})

async function loadPreflight() {
    const button = document.getElementById('btn-preflight-run')
    const originalText = button.textContent
    button.disabled = true
    button.textContent = '检查中...'
    try {
        const report = await api('/api/preflight')
        renderPreflight(report)
        if (report.summary?.status === 'blocked') {
            toast('体检发现阻断项，请先处理后再运行', 'err')
        } else if (report.summary?.status === 'warning') {
            toast('体检完成，有警告项需要留意', 'warn')
        } else {
            toast('体检通过，可以运行', 'ok')
        }
    } catch (err) {
        toast(`体检失败: ${err.message}`, 'err')
    } finally {
        button.disabled = false
        button.textContent = originalText
    }
}

function renderPreflight(report) {
    const summary = report.summary || {}
    const summaryEl = document.getElementById('preflight-summary')
    const results = document.getElementById('preflight-results')
    const tbody = document.getElementById('preflight-tbody')
    const statusLabel = {
        ready: '可以运行',
        warning: '可以运行，但有警告',
        blocked: '暂不建议运行'
    }[summary.status] || '未知'

    summaryEl.innerHTML = `${preflightBadge(summary.status)} ${escapeHtml(statusLabel)} · 通过 ${summary.ok || 0} 项，警告 ${summary.warn || 0} 项，阻断 ${summary.fail || 0} 项`
    tbody.innerHTML = (report.checks || []).map(item => `
        <tr>
            <td>${escapeHtml(item.label)}</td>
            <td>${preflightBadge(item.status)}</td>
            <td>${escapeHtml(item.detail || '-')}</td>
            <td>${escapeHtml(item.hint || '-')}</td>
        </tr>
    `).join('')
    results.classList.remove('hidden')
}

function preflightBadge(status) {
    if (status === 'ok' || status === 'ready') return '<span class="badge ok">通过</span>'
    if (status === 'fail' || status === 'blocked') return '<span class="badge warn">阻断</span>'
    return '<span class="badge warn">警告</span>'
}

document.getElementById('btn-preflight-run').addEventListener('click', loadPreflight)

async function loadStatus() { return loadDashboard() }

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

async function loadAccounts() {
    try {
        const { accounts } = await api('/api/accounts')
        state.accounts = accounts
        renderAccounts()
    } catch (err) {
        toast(`加载账号失败: ${err.message}`, 'err')
    }
}

function renderAccounts() {
    const tbody = document.getElementById('accounts-tbody')
    if (state.accounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty">还没有账号，点右上角「+ 添加账号」</td></tr>'
        if (state.pendingAccountFocus) {
            toast(`账号页里找不到 ${state.pendingAccountFocus}，它可能只存在于历史报表中`, 'err')
            state.pendingAccountFocus = null
        }
        return
    }
    tbody.innerHTML = ''
    state.accounts.forEach(acc => {
        const tr = document.createElement('tr')
        tr.dataset.email = acc.email
        const fingerprint = []
        if (acc.saveFingerprint?.mobile) fingerprint.push('移动')
        if (acc.saveFingerprint?.desktop) fingerprint.push('桌面')
        tr.innerHTML = `
            <td>${escapeHtml(acc.email)}</td>
            <td>${acc.enabled === false ? '<span class="badge warn">已停用</span>' : '<span class="badge ok">启用</span>'}</td>
            <td>${escapeHtml(acc.geoLocale || '-')}</td>
            <td>${escapeHtml(acc.langCode || '-')}</td>
            <td>${acc.hasTotpSecret ? '<span class="badge ok">已开</span>' : '<span class="badge">未开</span>'}</td>
            <td>${acc.proxy?.url ? `<span class="badge ok">${escapeHtml(acc.proxy.url)}:${acc.proxy.port || ''}</span>` : '<span class="badge">无</span>'}</td>
            <td>${fingerprint.length ? fingerprint.map(f => `<span class="badge ok">${f}</span>`).join(' ') : '<span class="badge">无</span>'}</td>
            <td class="row-actions">
                <button class="btn btn-sm" data-act="edit" data-email="${escapeAttr(acc.email)}">编辑</button>
                <button class="btn btn-sm btn-danger" data-act="delete" data-email="${escapeAttr(acc.email)}">删除</button>
            </td>
        `
        tbody.appendChild(tr)
    })
    focusPendingAccountRow()
    tbody.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => onAccountAction(btn.dataset.act, btn.dataset.email))
    })
}

function focusPendingAccountRow() {
    const email = state.pendingAccountFocus
    if (!email) return

    const rows = Array.from(document.querySelectorAll('#accounts-tbody tr[data-email]'))
    const target = rows.find(row => row.dataset.email === email)
    state.pendingAccountFocus = null

    if (!target) {
        toast(`账号页里找不到 ${email}，它可能只存在于历史报表中`, 'err')
        return
    }

    target.classList.add('row-focus')
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => target.classList.remove('row-focus'), 2200)
}

function onAccountAction(act, email) {
    if (act === 'edit') openAccountDialog(state.accounts.find(a => a.email === email))
    if (act === 'delete') deleteAccount(email)
}

async function deleteAccount(email) {
    if (!confirm(`确认删除账号 ${email}?\n（不会删除已保存的 session，请单独清理）`)) return
    try {
        await api(`/api/accounts/${encodeURIComponent(email)}`, { method: 'DELETE' })
        toast(`已删除 ${email}`, 'ok')
        loadAccounts()
    } catch (err) {
        toast(`删除失败: ${err.message}`, 'err')
    }
}

// Account dialog
const dialog = document.getElementById('account-dialog')
const accountForm = document.getElementById('account-form')
let dialogMode = 'add'
let dialogEditingEmail = null

function openAccountDialog(account) {
    dialogMode = account ? 'edit' : 'add'
    dialogEditingEmail = account?.email || null
    document.getElementById('account-dialog-title').textContent = account ? `编辑 ${account.email}` : '添加账号'
    document.getElementById('password-hint').textContent = account
        ? '编辑时留空表示保持原密码不变'
        : '新账号必填'
    accountForm.reset()
    if (account) {
        accountForm.email.value = account.email
        accountForm.email.readOnly = true
        accountForm.enabled.checked = account.enabled !== false
        accountForm.totpSecret.value = ''
        accountForm.recoveryEmail.value = account.recoveryEmail || ''
        accountForm.geoLocale.value = account.geoLocale || 'auto'
        accountForm.langCode.value = account.langCode || 'zh'
        accountForm.queryEngines.value = (account.queryEngines || []).join(',')
        accountForm['proxy.url'].value = account.proxy?.url || ''
        accountForm['proxy.port'].value = account.proxy?.port || 0
        accountForm['proxy.username'].value = account.proxy?.username || ''
        accountForm['proxy.password'].value = ''
        accountForm['proxy.proxyAxios'].checked = Boolean(account.proxy?.proxyAxios)
        accountForm['saveFingerprint.mobile'].checked = Boolean(account.saveFingerprint?.mobile)
        accountForm['saveFingerprint.desktop'].checked = Boolean(account.saveFingerprint?.desktop)
    } else {
        accountForm.email.readOnly = false
        accountForm.enabled.checked = true
        accountForm['saveFingerprint.mobile'].checked = true
        accountForm['saveFingerprint.desktop'].checked = true
    }
    dialog.showModal()
}

document.getElementById('btn-add-account').addEventListener('click', () => openAccountDialog(null))
document.getElementById('account-cancel').addEventListener('click', () => dialog.close())

accountForm.addEventListener('submit', async event => {
    event.preventDefault()
    const fd = new FormData(accountForm)
    const queryEnginesRaw = (fd.get('queryEngines') || '').toString().trim()
    // 空输入 → 空数组（明确表示"用 config 默认"，覆盖之前可能存在的账号级设定）
    const queryEnginesList = queryEnginesRaw
        ? queryEnginesRaw.split(',').map(s => s.trim()).filter(Boolean)
        : []
    const payload = {
        email: fd.get('email'),
        enabled: accountForm.enabled.checked,
        password: fd.get('password') || undefined,
        totpSecret: fd.get('totpSecret') || undefined,
        recoveryEmail: fd.get('recoveryEmail') || undefined,
        geoLocale: fd.get('geoLocale') || 'auto',
        langCode: fd.get('langCode') || 'zh',
        queryEngines: queryEnginesList,
        proxy: {
            url: fd.get('proxy.url') || '',
            port: Number(fd.get('proxy.port')) || 0,
            username: fd.get('proxy.username') || '',
            password: fd.get('proxy.password') || undefined,
            proxyAxios: accountForm['proxy.proxyAxios'].checked
        },
        saveFingerprint: {
            mobile: accountForm['saveFingerprint.mobile'].checked,
            desktop: accountForm['saveFingerprint.desktop'].checked
        }
    }
    try {
        if (dialogMode === 'add') {
            if (!payload.password) {
                toast('新账号必须填密码', 'err')
                return
            }
            await api('/api/accounts', { method: 'POST', body: payload })
            toast(`已添加 ${payload.email}`, 'ok')
        } else {
            await api(`/api/accounts/${encodeURIComponent(dialogEditingEmail)}`, {
                method: 'PUT',
                body: payload
            })
            toast('已保存', 'ok')
        }
        dialog.close()
        loadAccounts()
    } catch (err) {
        toast(`保存失败: ${err.message}`, 'err')
    }
})

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

async function loadSessions() {
    try {
        const { sessions } = await api('/api/sessions')
        state.sessions = sessions
        renderSessions()
    } catch (err) {
        toast(`加载 session 失败: ${err.message}`, 'err')
    }
}

function renderSessions() {
    const tbody = document.getElementById('sessions-tbody')
    const capabilities = currentCapabilities()
    const openHint = isDockerRuntime()
        ? 'Docker 里不能直接弹浏览器。请先在本地完成登录，再把 sessions/ 挂载进容器。'
        : '点「打开浏览器」会弹出 Chromium 窗口。若账号未登录，请在窗口里手动完成登录，关闭窗口后 session 会自动保存到本地。'
    document.getElementById('sessions-hint').textContent = openHint
    if (state.sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">先到「账号」Tab 添加账号</td></tr>'
        return
    }
    tbody.innerHTML = ''
    state.sessions.forEach(s => {
        const tr = document.createElement('tr')
        const fmtDate = s.lastLoginAt
            ? new Date(s.lastLoginAt).toLocaleString('zh-CN', { hour12: false })
            : '—'
        const openDisabled = !capabilities.canOpenBrowserSession
            ? ' disabled title="Docker 里不能直接弹浏览器，请先在本地生成 session 后挂载进来"'
            : ''
        tr.innerHTML = `
            <td>${escapeHtml(s.email)} ${s.isLoggedIn ? '<span class="badge ok">已登录</span>' : '<span class="badge warn">未登录</span>'}</td>
            <td>${s.desktop.cookies ? `<span class="badge ok">${s.desktop.cookies}</span>` : '<span class="badge">无</span>'} ${s.desktop.fingerprint ? '<span class="badge ok">指纹</span>' : ''}</td>
            <td>${s.mobile.cookies ? `<span class="badge ok">${s.mobile.cookies}</span>` : '<span class="badge">无</span>'} ${s.mobile.fingerprint ? '<span class="badge ok">指纹</span>' : ''}</td>
            <td>${s.desktop.fingerprint || s.mobile.fingerprint ? '已保存' : '—'}</td>
            <td>${escapeHtml(fmtDate)}</td>
            <td class="row-actions">
                <button class="btn btn-sm btn-primary" data-act="open" data-email="${escapeAttr(s.email)}"${openDisabled}>打开浏览器</button>
                <button class="btn btn-sm btn-danger" data-act="clear" data-email="${escapeAttr(s.email)}">清除</button>
            </td>
        `
        tbody.appendChild(tr)
    })
    tbody.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => onSessionAction(btn.dataset.act, btn.dataset.email))
    })
}

async function onSessionAction(act, email) {
    if (act === 'open') await openBrowser(email)
    if (act === 'clear') await clearSession(email)
}

async function openBrowser(email) {
    if (!currentCapabilities().canOpenBrowserSession) {
        toast('Docker 里不能直接弹浏览器。请先在本地生成 session，再把 sessions/ 挂载进容器。', 'err')
        return
    }
    try {
        const { jobId } = await api(`/api/sessions/${encodeURIComponent(email)}/open`, {
            method: 'POST',
            body: {}
        })
        toast(`已为 ${email} 启动浏览器窗口。若是首次登录请在窗口中完成操作，关闭窗口后 session 将被保存。`, 'ok')
        state.activeJobId = jobId
        switchTab('logs')
        await loadJobs()
        renderCurrentLogSource(jobId)
        subscribeLogs(jobId)
    } catch (err) {
        toast(`打开浏览器失败: ${err.message}`, 'err')
    }
}

async function clearSession(email) {
    if (!confirm(`确认清除 ${email} 的 session？清除后需要重新登录。`)) return
    try {
        await api(`/api/sessions/${encodeURIComponent(email)}`, { method: 'DELETE' })
        toast(`已清除 ${email}`, 'ok')
        loadSessions()
    } catch (err) {
        toast(`清除失败: ${err.message}`, 'err')
    }
}

document.getElementById('btn-refresh-sessions').addEventListener('click', loadSessions)
document.getElementById('btn-clear-all-sessions').addEventListener('click', async () => {
    if (!confirm('确认清除全部账号的 session？此操作不可撤销。')) return
    try {
        await api('/api/sessions', { method: 'DELETE' })
        toast('已清除全部 session', 'ok')
        loadSessions()
    } catch (err) {
        toast(`清除失败: ${err.message}`, 'err')
    }
})

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_LABELS = {
    doDailySet: '每日任务集',
    doSpecialPromotions: '特别推广',
    doMorePromotions: '更多推广',
    doPunchCards: '打卡',
    doAppPromotions: '应用推广',
    doDesktopSearch: '桌面搜索',
    doMobileSearch: '移动搜索',
    doDailyCheckIn: '每日签到',
    doReadToEarn: '阅读赚取'
}

async function loadConfig() {
    try {
        const { config } = await api('/api/config')
        state.config = config
        renderConfig()
    } catch (err) {
        toast(`加载配置失败: ${err.message}`, 'err')
    }
}

function renderConfig() {
    const form = document.getElementById('config-form')
    form.innerHTML = ''
    const cfg = state.config
    document.getElementById('config-hint').innerHTML = currentCapabilities().canBuildProject
        ? '改完保存后，下次运行立即生效。代码维护动作已收口到「环境 & 修复」。'
        : '改完保存后，下次运行立即生效。Docker 运行时镜像不承担重新构建；如果改了 TypeScript 代码，请在宿主机重新构建镜像后再启动容器。'

    form.appendChild(section('核心', [
        textField('baseURL', cfg.baseURL, '基础 URL'),
        textField('sessionPath', cfg.sessionPath, 'session 目录名'),
        checkboxField('headless', cfg.headless, '无头模式（Docker 必须开）'),
        numberField('clusters', cfg.clusters ?? 1, '并发进程数'),
        checkboxField('errorDiagnostics', cfg.errorDiagnostics ?? false, '错误诊断（输出调试截图）')
    ]))

    form.appendChild(section('任务开关',
        Object.keys(WORKER_LABELS).map(k =>
            checkboxField(`workers.${k}`, Boolean(cfg.workers?.[k]), WORKER_LABELS[k])
        )
    ))

    form.appendChild(section('搜索', [
        checkboxField('searchSettings.scrollRandomResults', cfg.searchSettings?.scrollRandomResults, '随机滚动结果'),
        probabilityField(
            'searchSettings.clickRandomResults',
            cfg.searchSettings?.clickRandomResults ?? 0.6,
            '点击结果的概率（0=不点，1=每次都点）'
        ),
        checkboxField('searchSettings.parallelSearching', cfg.searchSettings?.parallelSearching, '并行桌面/移动搜索'),
        checkboxField(
            'searchSettings.queryMutation',
            cfg.searchSettings?.queryMutation ?? true,
            '查询词变体（~18% 概率给词尾加后缀，打散跨账号重合）'
        ),
        textField('searchSettings.queryEngines', (cfg.searchSettings?.queryEngines || []).join(','), '热搜来源（逗号分隔: china,google,wikipedia,reddit,local）'),
        textField(
            'searchSettings.searchResultVisitTime.min',
            (typeof cfg.searchSettings?.searchResultVisitTime === 'object'
                ? cfg.searchSettings.searchResultVisitTime.min
                : null) ?? '8sec',
            '停留时间最小'
        ),
        textField(
            'searchSettings.searchResultVisitTime.max',
            (typeof cfg.searchSettings?.searchResultVisitTime === 'object'
                ? cfg.searchSettings.searchResultVisitTime.max
                : null) ?? '45sec',
            '停留时间最大'
        ),
        textField('searchSettings.searchDelay.min', cfg.searchSettings?.searchDelay?.min ?? '5min', '搜索间隔最小'),
        textField('searchSettings.searchDelay.max', cfg.searchSettings?.searchDelay?.max ?? '9min', '搜索间隔最大'),
        textField('searchSettings.readDelay.min', cfg.searchSettings?.readDelay?.min ?? '6min', '阅读间隔最小'),
        textField('searchSettings.readDelay.max', cfg.searchSettings?.readDelay?.max ?? '11min', '阅读间隔最大')
    ]))

    form.appendChild(section('安静时段（仿真人作息）', [
        checkboxField('quietHours.enabled', cfg.quietHours?.enabled ?? false, '启用'),
        textField('quietHours.start', cfg.quietHours?.start ?? '01:00', '开始时间 HH:MM'),
        textField('quietHours.end', cfg.quietHours?.end ?? '06:00', '结束时间 HH:MM（早于开始 = 跨午夜）')
    ]))

    form.appendChild(section('账号健康保护', [
        checkboxField('accountHealth.autoSkip.enabled', cfg.accountHealth?.autoSkip?.enabled ?? false, '自动跳过异常账号'),
        numberField('accountHealth.autoSkip.riskCooldownHours', cfg.accountHealth?.autoSkip?.riskCooldownHours ?? 24, '风控冷却小时'),
        numberField('accountHealth.autoSkip.maxConsecutiveFailures', cfg.accountHealth?.autoSkip?.maxConsecutiveFailures ?? 3, '连续失败跳过阈值')
    ]))

    form.appendChild(section('Webhook · Discord', [
        checkboxField('webhook.discord.enabled', cfg.webhook?.discord?.enabled ?? false, '启用'),
        textField('webhook.discord.url', cfg.webhook?.discord?.url ?? '', 'Webhook URL')
    ]))
    form.appendChild(section('Webhook · ntfy', [
        checkboxField('webhook.ntfy.enabled', cfg.webhook?.ntfy?.enabled ?? false, '启用'),
        textField('webhook.ntfy.url', cfg.webhook?.ntfy?.url ?? '', 'URL'),
        textField('webhook.ntfy.topic', cfg.webhook?.ntfy?.topic ?? '', 'topic'),
        textField('webhook.ntfy.token', cfg.webhook?.ntfy?.token ?? '', 'token（可选）')
    ]))
    form.appendChild(section('Webhook · PushPlus（微信）', [
        checkboxField('webhook.pushplus.enabled', cfg.webhook?.pushplus?.enabled ?? false, '启用'),
        textField('webhook.pushplus.token', cfg.webhook?.pushplus?.token ?? '', 'token（从 pushplus.plus 获取）')
    ]))

}

function section(title, fields) {
    const div = document.createElement('div')
    div.className = 'cfg-section'
    const h = document.createElement('h4')
    h.textContent = title
    div.appendChild(h)
    const wrap = document.createElement('div')
    wrap.className = 'cfg-fields'
    fields.forEach(f => wrap.appendChild(f))
    div.appendChild(wrap)
    return div
}

function textField(name, value, label) {
    const f = document.createElement('div')
    f.className = 'cfg-field'
    const v = value ?? ''
    f.innerHTML = `<label>${escapeHtml(label)}</label><input type="text" name="${escapeAttr(name)}" value="${escapeAttr(String(v))}" />`
    return f
}
function numberField(name, value, label) {
    const f = document.createElement('div')
    f.className = 'cfg-field'
    f.innerHTML = `<label>${escapeHtml(label)}</label><input type="number" name="${escapeAttr(name)}" value="${Number(value) || 0}" min="0" />`
    return f
}
function checkboxField(name, value, label) {
    const f = document.createElement('div')
    f.className = 'cfg-field inline'
    f.innerHTML = `<input type="checkbox" id="cfg-${escapeAttr(name)}" name="${escapeAttr(name)}"${value ? ' checked' : ''} /><label for="cfg-${escapeAttr(name)}">${escapeHtml(label)}</label>`
    return f
}
function probabilityField(name, value, label) {
    // 0-1 概率：用 range slider 更直观。兼容读取 boolean（true→1, false→0）。
    const num = typeof value === 'number' ? value : value ? 1 : 0
    const f = document.createElement('div')
    f.className = 'cfg-field'
    f.innerHTML = `
        <label>${escapeHtml(label)}</label>
        <div style="display:flex;gap:8px;align-items:center;">
            <input type="range" name="${escapeAttr(name)}" min="0" max="1" step="0.05" value="${num}" data-probability="1" style="flex:1;" />
            <span class="cfg-prob-readout" style="min-width:3em;text-align:right;color:var(--text-muted);">${num.toFixed(2)}</span>
        </div>
    `
    const slider = f.querySelector('input[type="range"]')
    const readout = f.querySelector('.cfg-prob-readout')
    slider.addEventListener('input', () => {
        readout.textContent = Number(slider.value).toFixed(2)
    })
    return f
}

function readFormToConfig() {
    const form = document.getElementById('config-form')
    const base = structuredClone(state.config)
    const inputs = form.querySelectorAll('input[name]')
    inputs.forEach(input => {
        const dotted = input.name
        let value
        if (input.type === 'checkbox') value = input.checked
        else if (input.type === 'number') value = Number(input.value) || 0
        else if (input.type === 'range') value = Number(input.value)
        else value = input.value
        // Special case: queryEngines is a CSV
        if (dotted === 'searchSettings.queryEngines') {
            value = value.split(',').map(s => s.trim()).filter(Boolean)
        }
        setDotted(base, dotted, value)
    })
    return base
}

function setDotted(obj, dottedKey, value) {
    const parts = dottedKey.split('.')
    let cur = obj
    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]
        if (cur[p] === undefined || cur[p] === null || typeof cur[p] !== 'object') cur[p] = {}
        cur = cur[p]
    }
    cur[parts[parts.length - 1]] = value
}

document.getElementById('btn-save-config').addEventListener('click', async () => {
    try {
        const next = readFormToConfig()
        await api('/api/config', { method: 'PUT', body: { config: next } })
        toast('配置已保存', 'ok')
        state.config = next
    } catch (err) {
        toast(`保存失败: ${err.message}`, 'err')
    }
})

document.getElementById('btn-reload-config').addEventListener('click', loadConfig)

// ─────────────────────────────────────────────────────────────────────────────
// Jobs & logs
// ─────────────────────────────────────────────────────────────────────────────

async function loadJobs(options = {}) {
    try {
        const [{ jobs }, status] = await Promise.all([
            api('/api/jobs'),
            api('/api/status').catch(() => state.status)
        ])
        state.jobs = jobs
        if (status) state.status = status
        const selectedJobId = renderCurrentLogSource()
        updateRunButtons()
        if (options.autoSubscribe && selectedJobId) {
            subscribeLogs(Number(selectedJobId))
        }
    } catch (err) {
        toast(`加载任务失败: ${err.message}`, 'err')
    }
}

function renderCurrentLogSource(jobId = chooseLogJobId(state.jobs)) {
    const selectedJob = state.jobs.find(job => String(job.id) === String(jobId))
    const label = document.getElementById('job-source-label')
    if (label) {
        label.textContent = formatCurrentLogSourceLabel(selectedJob)
    }
    return selectedJob ? String(selectedJob.id) : ''
}

function updateRunButtons() {
    const capabilities = currentCapabilities()
    const btnStart = document.getElementById('btn-run-start')
    const btnStop = document.getElementById('btn-run-stop')
    const pill = document.getElementById('job-status-pill')
    const runState = describeRunUiState({
        jobs: state.jobs,
        externalRun: state.status?.externalRun,
        capabilities
    })
    if (runState.kind === 'running') {
        btnStart.disabled = runState.startDisabled
        btnStop.classList.remove('hidden')
        btnStop.dataset.jobId = runState.stopJobId
        pill.className = 'pill run'
        pill.textContent = runState.logPillText
    } else if (runState.kind === 'external') {
        btnStart.disabled = runState.startDisabled
        btnStop.classList.add('hidden')
        pill.className = 'pill run'
        pill.textContent = runState.logPillText
    } else {
        btnStart.disabled = runState.startDisabled
        btnStop.classList.add('hidden')
        pill.className = 'pill'
        pill.textContent = runState.logPillText
    }
}

document.getElementById('btn-run-start').addEventListener('click', async () => {
    try {
        const { jobId } = await api('/api/run/start', { method: 'POST', body: {} })
        toast(`已启动任务 #${jobId}`, 'ok')
        state.activeJobId = jobId
        await loadJobs()
        renderCurrentLogSource(jobId)
        subscribeLogs(jobId)
    } catch (err) {
        toast(`启动失败: ${err.message}`, 'err')
    }
})

document.getElementById('btn-run-stop').addEventListener('click', async event => {
    const id = event.currentTarget.dataset.jobId
    if (!id) return
    if (!confirm(`确认停止任务 #${id}？`)) return
    try {
        await api(`/api/jobs/${id}/stop`, { method: 'POST', body: {} })
        toast('已停止', 'ok')
        loadJobs()
    } catch (err) {
        toast(`停止失败: ${err.message}`, 'err')
    }
})

function subscribeLogs(jobId) {
    if (state.sse) {
        state.sse.close()
        state.sse = null
    }
    const box = document.getElementById('logbox')
    box.innerHTML = ''
    const q = jobId ? `?jobId=${jobId}` : ''
    const token = getToken()
    // EventSource doesn't support headers. Fall back to fetch + ReadableStream when token is set.
    if (token) {
        streamWithFetch(`/api/logs/stream${q}`, token)
        return
    }
    const es = new EventSource(`/api/logs/stream${q}`)
    state.sse = es
    es.onmessage = ev => handleLogEvent(ev.data)
    es.onerror = () => {
        appendLog({ stream: 'stderr', line: '[前端] SSE 连接中断，正在尝试恢复...' })
    }
}

async function streamWithFetch(url, token) {
    const controller = new AbortController()
    state.sse = { close: () => controller.abort() }
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal
        })
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop()
            for (const raw of lines) {
                if (raw.startsWith('data: ')) handleLogEvent(raw.slice(6))
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            appendLog({ stream: 'stderr', line: `[前端] 日志流错误: ${err.message}` })
        }
    }
}

function handleLogEvent(data) {
    try {
        const obj = JSON.parse(data)
        if (obj.kind === 'line') appendLog(obj)
        if (obj.kind === 'exit') {
            appendLog({ stream: 'stdout', line: `[runner] 任务退出 code=${obj.code} signal=${obj.signal}` })
            loadJobs()
        }
    } catch {
        // ignore
    }
}

function appendLog(entry) {
    const box = document.getElementById('logbox')
    const line = document.createElement('span')
    line.className = `log-line ${entry.stream || ''}`
    const t = entry.t ? new Date(entry.t).toLocaleTimeString('zh-CN', { hour12: false }) : ''
    line.innerHTML = `<span class="log-meta">[${t}]</span>${escapeHtml(entry.line || '')}\n`
    box.appendChild(line)
    // Auto-scroll only if already near bottom
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
    if (nearBottom) box.scrollTop = box.scrollHeight
    // Cap DOM size
    if (box.childElementCount > 2500) {
        for (let i = 0; i < 500; i++) box.firstChild?.remove()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 收益报表 Tab
// ─────────────────────────────────────────────────────────────────────────────

async function loadReports() {
    const filters = getReportFilters()
    state.reportFilters = filters
    const params = buildReportQueryParams(filters)
    try {
        const report = await api('/api/reports/earnings?' + params.toString())
        state.reports = report
        syncReportAccountOptions(report.filters?.accounts || [], filters.account)
        renderReports(report, filters)
    } catch (err) {
        toast('加载收益报表失败: ' + err.message, 'err')
    }
}

function getReportFilters() {
    return {
        range: document.getElementById('reports-range')?.value || state.reportFilters.range || '7d',
        account: document.getElementById('reports-account')?.value || state.reportFilters.account || 'all'
    }
}

function buildReportQueryParams(filters) {
    const params = new URLSearchParams({
        range: filters.range,
        timezoneOffsetMinutes: String(new Date().getTimezoneOffset())
    })
    if (filters.account && filters.account !== 'all') {
        params.set('account', filters.account)
    }
    return params
}

function syncReportAccountOptions(accounts, selectedAccount = 'all') {
    const select = document.getElementById('reports-account')
    const nextOptions = ['all', ...accounts.filter(Boolean)]
    const current = nextOptions.includes(selectedAccount) ? selectedAccount : 'all'

    select.innerHTML = nextOptions.map(email =>
        email === 'all'
            ? '<option value="all">全部账号</option>'
            : `<option value="${escapeAttr(email)}">${escapeHtml(email)}</option>`
    ).join('')
    select.value = current
    state.reportFilters.account = current
}

function renderReports(report, filters = state.reportFilters) {
    const totals = report.totals || {}
    const selectedAccount = filters.account || 'all'
    const isFiltered = selectedAccount !== 'all'
    const isEmpty = (totals.runs || 0) === 0
    const attentionAccounts = (report.accounts || []).filter(item => item.consecutiveFailures > 0 || item.lastStatus === 'risk_control')
    const rangeLabel = formatReportRangeLabel(report.window?.range || filters.range)

    document.getElementById('reports-total-points').textContent = formatPoints(totals.collectedPoints || 0)
    document.getElementById('reports-total-sub').textContent = totals.runs
        ? `${rangeLabel} · ${isFiltered ? selectedAccount : '全部账号'} · ${totals.runs} 次运行 · ${totals.accounts} 个账号结果`
        : isFiltered
            ? `当前范围内 ${selectedAccount} 暂无记录`
            : '暂无运行记录'
    document.getElementById('reports-success-rate').textContent = Number(totals.successRate || 0).toFixed(1) + '%'
    document.getElementById('reports-success-sub').textContent = totals.accounts
        ? '失败账号结果: ' + (totals.failedAccounts || 0)
        : '—'
    document.getElementById('reports-risk-count').textContent = String(totals.riskControlStops || 0)
    document.getElementById('reports-attention-count').textContent = String(attentionAccounts.length)
    document.getElementById('reports-attention-sub').textContent = attentionAccounts.length
        ? `当前范围内需关注的账号: ${attentionAccounts.length}`
        : '当前范围内暂无异常账号'

    renderProblemAccounts(report.accounts || [], { isEmpty, selectedAccount })
    renderFailureBuckets(report.failureBuckets || [], { isEmpty })
    renderAccountHealth(report.health, { selectedAccount })
    renderFailureSnapshots(report.failureSnapshots || [], { selectedAccount })
    renderReportDaily(report.daily || [], { isEmpty })
    renderReportTasks(report.taskSummary || [], { isEmpty })
    renderReportAccounts(report.accounts || [], { isEmpty, selectedAccount })
    renderReportRuns(report.recentRuns || [], { isEmpty })
}

function renderProblemAccounts(items, { isEmpty, selectedAccount }) {
    const tbody = document.getElementById('reports-issues-tbody')
    const problems = items
        .filter(item => item.consecutiveFailures > 0 || item.lastStatus === 'risk_control')
        .sort((a, b) =>
            Number(b.lastStatus === 'risk_control') - Number(a.lastStatus === 'risk_control') ||
            (b.consecutiveFailures || 0) - (a.consecutiveFailures || 0) ||
            (new Date(b.lastFailureAt || 0).getTime() || 0) - (new Date(a.lastFailureAt || 0).getTime() || 0)
        )

    if (isEmpty) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty">${selectedAccount !== 'all' ? '当前范围内该账号暂无记录' : '暂无收益记录，脚本完整运行一次后会出现数据'}</td></tr>`
        return
    }
    if (!problems.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">当前范围内暂无需要关注的账号</td></tr>'
        return
    }

    tbody.innerHTML = problems.map(item => {
        const reason = item.lastError
            ? `<span class="badge warn" title="${escapeAttr(item.lastError)}">${escapeHtml(truncateText(item.lastError, 20))}</span>`
            : `<span class="badge">${escapeHtml(formatFailureBucketLabel(item.primaryFailureBucket))}</span>`
        return '<tr>' +
            `<td>${escapeHtml(item.email)}</td>` +
            `<td>${formatStatusBadge(item.lastStatus)}</td>` +
            `<td>${item.consecutiveFailures || 0}</td>` +
            `<td>${formatDateTime(item.lastFailureAt)}</td>` +
            `<td>${reason}</td>` +
            `<td><button class="btn btn-sm" data-report-act="view-account" data-email="${escapeAttr(item.email)}">查看账号</button></td>` +
            '</tr>'
    }).join('')

    bindReportAccountButtons()
}

function renderFailureBuckets(items, { isEmpty }) {
    const list = document.getElementById('reports-failure-list')
    const empty = document.getElementById('reports-failures-empty')
    const maxCount = Math.max(...items.map(item => Number(item.count) || 0), 0)

    if (isEmpty || maxCount === 0) {
        list.innerHTML = ''
        empty.classList.remove('hidden')
        empty.textContent = isEmpty ? '当前范围内还没有运行失败记录' : '当前范围内没有失败记录'
        return
    }

    empty.classList.add('hidden')
    list.innerHTML = items.map(item => {
        const width = maxCount > 0 ? (Number(item.count || 0) / maxCount) * 100 : 0
        return '<div class="bar-row">' +
            `<div class="bar-label">${escapeHtml(item.label)}</div>` +
            `<div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(1)}%"></div></div>` +
            `<div class="bar-value">${item.count} 次 / ${item.accountCount} 号</div>` +
            '</div>'
    }).join('')
}

function openReportedAccount(email) {
    if (!email) return
    state.pendingAccountFocus = email
    switchTab('accounts')
}

function bindReportAccountButtons() {
    document.querySelectorAll('button[data-report-act="view-account"]').forEach(btn => {
        btn.addEventListener('click', () => openReportedAccount(btn.dataset.email))
    })
}

function formatReportRangeLabel(range) {
    if (range === 'today') return '今天'
    if (range === '7d') return '近 7 天'
    if (range === '30d') return '近 30 天'
    return range || '当前范围'
}

function formatFailureBucketLabel(key) {
    return {
        risk_control: '风控拦截',
        login: '登录失败',
        session: '会话失效',
        network: '网络异常',
        flow: '流程异常',
        unknown: '未归类'
    }[key] || '未归类'
}

function formatStatusBadge(status) {
    if (status === 'risk_control') return '<span class="badge warn">风控停止</span>'
    if (status === 'failed') return '<span class="badge warn">异常</span>'
    if (status === 'no_data') return '<span class="badge">暂无数据</span>'
    return '<span class="badge ok">正常</span>'
}

function formatHealthBadge(item) {
    const score = Number(item?.score ?? 0)
    if (item?.level === 'risk') return `<span class="badge warn">${score} · 风险</span>`
    if (item?.level === 'warning') return `<span class="badge warn">${score} · 关注</span>`
    if (item?.level === 'unknown') return `<span class="badge">${score} · 未运行</span>`
    return `<span class="badge ok">${score} · 健康</span>`
}

function renderAccountHealth(health, { selectedAccount }) {
    const tbody = document.getElementById('reports-health-tbody')
    const accounts = health?.accounts || []

    if (!accounts.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty">${selectedAccount !== 'all' ? '当前账号暂无健康数据' : '暂无账号健康数据'}</td></tr>`
        return
    }

    tbody.innerHTML = accounts.map(item => {
        const suggestion = item.suggestion
            ? `<span title="${escapeAttr(item.suggestion)}">${escapeHtml(truncateText(item.suggestion, 34))}</span>`
            : '-'
        return '<tr>' +
            `<td>${escapeHtml(item.email)}</td>` +
            `<td>${formatHealthBadge(item)}</td>` +
            `<td>${formatStatusBadge(item.status)}</td>` +
            `<td>${item.consecutiveFailures || 0}</td>` +
            `<td>${suggestion}</td>` +
            `<td>${formatDateTime(item.lastSuccessAt)}</td>` +
            `<td>${formatDateTime(item.lastFailureAt)}</td>` +
            '</tr>'
    }).join('')
}

function renderFailureSnapshots(items, { selectedAccount }) {
    const tbody = document.getElementById('reports-snapshots-tbody')
    if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty">${selectedAccount !== 'all' ? '当前账号暂无失败现场' : '暂无失败现场记录'}</td></tr>`
        return
    }

    tbody.innerHTML = items.map(item => {
        const error = item.error
            ? `<span class="badge warn" title="${escapeAttr(item.error)}">${escapeHtml(truncateText(item.error, 28))}</span>`
            : `<span class="badge">${escapeHtml(formatFailureBucketLabel(item.failureBucket))}</span>`
        const url = item.url
            ? `<span title="${escapeAttr(item.url)}">${escapeHtml(truncateText(item.url, 42))}</span>`
            : '-'
        return '<tr>' +
            `<td>${formatDateTime(item.capturedAt)}</td>` +
            `<td>${escapeHtml(item.account)}</td>` +
            `<td>${escapeHtml(item.stage || 'unknown')}</td>` +
            `<td>${error}</td>` +
            `<td>${escapeHtml(item.pageTitle || '-')}</td>` +
            `<td>${url}</td>` +
            '</tr>'
    }).join('')
}

function truncateText(value, maxLength = 24) {
    const text = String(value || '')
    return text.length > maxLength ? text.slice(0, Math.max(0, maxLength - 3)) + '...' : text
}

function renderReportDaily(items, { isEmpty }) {
    const tbody = document.getElementById('reports-daily-tbody')
    if (isEmpty) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无收益记录，脚本完整运行一次后会出现数据</td></tr>'
        return
    }
    tbody.innerHTML = items.map(item => {
        const risk = item.riskControlStops ? '<span class="badge warn">' + item.riskControlStops + '</span>' : '0'
        return '<tr>' +
            '<td>' + escapeHtml(item.date) + '</td>' +
            '<td>' + (item.runs || 0) + '</td>' +
            '<td>' + (item.accounts || 0) + '</td>' +
            '<td><span class="badge ok">' + formatPoints(item.collectedPoints || 0) + '</span></td>' +
            '<td>' + (item.successCount || 0) + ' / ' + (item.failedCount || 0) + '</td>' +
            '<td>' + risk + '</td>' +
            '<td>' + formatDuration(item.totalDuration || 0) + '</td>' +
            '</tr>'
    }).join('')
}

function renderReportTasks(items, { isEmpty }) {
    const tbody = document.getElementById('reports-task-tbody')
    if (isEmpty || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">暂无任务级收益记录</td></tr>'
        return
    }

    tbody.innerHTML = items.map(item => {
        return '<tr>' +
            `<td>${escapeHtml(item.label || item.key)}</td>` +
            `<td>${item.accountCount || 0}</td>` +
            `<td><span class="badge ok">${formatPoints(item.collectedPoints || 0)}</span></td>` +
            `<td>${item.successCount || 0} / ${item.failedCount || 0} / ${item.skippedCount || 0}</td>` +
            `<td>${formatDuration(item.totalDuration || 0)}</td>` +
            '</tr>'
    }).join('')
}

function renderReportAccounts(items, { isEmpty, selectedAccount }) {
    const tbody = document.getElementById('reports-account-tbody')
    if (isEmpty) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty">${selectedAccount !== 'all' ? '当前范围内该账号暂无记录' : '暂无账号汇总'}</td></tr>`
        return
    }
    tbody.innerHTML = items.map(item => {
        const risk = item.riskControlStops ? '<span class="badge warn">' + item.riskControlStops + '</span>' : '0'
        const error = item.lastError ? '<span class="badge warn">' + escapeHtml(item.lastError) + '</span>' : '-'
        return '<tr>' +
            '<td>' + escapeHtml(item.email) + '</td>' +
            '<td>' + (item.runs || 0) + '</td>' +
            '<td><span class="badge ok">' + formatPoints(item.collectedPoints || 0) + '</span></td>' +
            '<td>' + (item.successCount || 0) + ' / ' + (item.failedCount || 0) + '</td>' +
            '<td>' + risk + '</td>' +
            '<td>' + formatStatusBadge(item.lastStatus) + '</td>' +
            '<td>' + formatDateTime(item.lastRunAt) + '</td>' +
            '<td>' + error + '</td>' +
            `<td><button class="btn btn-sm" data-report-act="view-account" data-email="${escapeAttr(item.email)}">查看账号</button></td>` +
            '</tr>'
    }).join('')

    bindReportAccountButtons()
}

function renderReportRuns(items, { isEmpty }) {
    const tbody = document.getElementById('reports-runs-tbody')
    if (isEmpty) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">暂无运行记录</td></tr>'
        return
    }
    tbody.innerHTML = items.map(item => {
        return '<tr>' +
            '<td>' + formatDateTime(item.startedAt) + '</td>' +
            '<td>' + (item.accountCount || 0) + '</td>' +
            '<td><span class="badge ok">' + formatPoints(item.totalCollectedPoints || 0) + '</span></td>' +
            '<td>' + (item.successCount || 0) + ' / ' + (item.failedCount || 0) + '</td>' +
            '<td>' + formatStatusBadge(item.status) + '</td>' +
            '</tr>'
    }).join('')
}

function formatPoints(value) {
    const n = Number(value) || 0
    return n >= 0 ? '+' + n : String(n)
}

function formatDuration(seconds) {
    const n = Number(seconds) || 0
    if (n < 60) return n.toFixed(0) + '秒'
    if (n < 3600) return (n / 60).toFixed(1) + '分钟'
    return (n / 3600).toFixed(1) + '小时'
}

function formatDateTime(value) {
    if (!value) return '-'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleString('zh-CN', { hour12: false })
}

function parseDownloadFilename(header) {
    if (!header) return 'earnings-report.zip'
    const match = header.match(/filename="([^"]+)"/i) || header.match(/filename=([^;]+)/i)
    return match?.[1] ? decodeURIComponent(match[1]) : 'earnings-report.zip'
}

async function downloadBlobWithAuth(url, fallbackName) {
    const res = await fetch(url, {
        headers: authHeaders()
    })
    if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
    }

    const blob = await res.blob()
    const filename = parseDownloadFilename(res.headers.get('content-disposition')) || fallbackName
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
    return filename
}

async function exportCurrentReport() {
    const btn = document.getElementById('btn-reports-export')
    const originalText = btn.textContent
    const filters = getReportFilters()
    const params = buildReportQueryParams(filters)

    btn.disabled = true
    btn.textContent = '导出中...'

    try {
        const filename = await downloadBlobWithAuth('/api/reports/earnings/export?' + params.toString(), 'earnings-report.zip')
        toast(`已导出 ${filename}`, 'ok')
    } catch (err) {
        toast(`导出失败: ${err.message}`, 'err')
    } finally {
        btn.disabled = false
        btn.textContent = originalText
    }
}

document.getElementById('btn-reports-refresh')?.addEventListener('click', loadReports)
document.getElementById('btn-reports-export')?.addEventListener('click', exportCurrentReport)
document.getElementById('reports-range')?.addEventListener('change', loadReports)
document.getElementById('reports-account')?.addEventListener('change', loadReports)
document.getElementById('btn-reports-failures-loghistory')?.addEventListener('click', () => switchTab('loghistory'))
document.getElementById('btn-reports-runs-loghistory')?.addEventListener('click', () => switchTab('loghistory'))
document.getElementById('btn-reports-snapshots-loghistory')?.addEventListener('click', () => switchTab('loghistory'))

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;')
}

// ─────────────────────────────────────────────────────────────────────────────
// 环境 Tab
// ─────────────────────────────────────────────────────────────────────────────

async function loadEnv() {
    try {
        const env = await api('/api/env')
        renderEnv(env)
    } catch (err) {
        toast(`环境检测失败: ${err.message}`, 'err')
    }
}

const ACTION_DESCRIPTIONS = {
    'install-chromium': '跑 npx patchright install chromium，重新下载浏览器二进制。',
    'install-deps': '以当前发行版的包管理器装 Chromium 需要的系统库（需 sudo）。',
    'npm-install': '重新安装 node_modules。',
    'build': '编译 TypeScript 到 dist/，只有代码改动后才需要跑。',
    upgrade: 'git pull --ff-only → npm install → npm run build，把整个项目升到最新。'
}

function renderEnv(env) {
    // platform
    const dl = document.getElementById('env-platform-dl')
    dl.innerHTML = Object.entries(env.platform)
        .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`)
        .join('')

    // checks
    const ul = document.getElementById('env-checks')
    ul.innerHTML = env.checks
        .map(
            c => `<li>
                <span class="mark ${c.ok ? 'ok' : 'err'}">${c.ok ? '✓' : '✗'}</span>
                <span><strong>${escapeHtml(c.name)}</strong> <code>${escapeHtml(c.value)}</code></span>
                <span></span>
                ${c.hint ? `<span class="hint">${escapeHtml(c.hint)}</span>` : ''}
            </li>`
        )
        .join('')

    // actions
    const actions = document.getElementById('env-actions')
    actions.innerHTML = env.actions
        .map(
            a => `<button class="btn action-btn" data-fix="${escapeAttr(a.id)}">
                <span class="action-label">${escapeHtml(a.label)}</span>
                <span class="action-desc">${escapeHtml(ACTION_DESCRIPTIONS[a.id] || '')}</span>
            </button>`
        )
        .join('')
    actions.querySelectorAll('button[data-fix]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.fix
            if (!confirm(`确认执行: ${btn.querySelector('.action-label').textContent}?`)) return
            try {
                const { jobId, label } = await api(`/api/env/fix/${id}`, { method: 'POST', body: {} })
                toast(`已启动: ${label}`, 'ok')
                switchTab('logs')
                await loadJobs()
                renderCurrentLogSource(jobId)
                subscribeLogs(jobId)
            } catch (err) {
                toast(`启动失败: ${err.message}`, 'err')
            }
        })
    })
}

document.getElementById('btn-env-refresh').addEventListener('click', loadEnv)

// ─────────────────────────────────────────────────────────────────────────────
// 定时 Tab (systemd)
// ─────────────────────────────────────────────────────────────────────────────

async function loadSchedule() {
    try {
        const sched = await api('/api/systemd')
        renderSchedule(sched)
    } catch (err) {
        toast(`加载定时状态失败: ${err.message}`, 'err')
        document.getElementById('schedule-reward-dl').innerHTML = '<dt>状态</dt><dd>' + escapeHtml(err.message) + '</dd>'
    }
}

function renderSchedule(sched) {
    const title = document.getElementById('schedule-title')
    const hint = document.getElementById('schedule-hint')
    const webuiCard = document.getElementById('schedule-webui-card')
    const journalCard = document.getElementById('schedule-journal-card')
    const btnInstall = document.getElementById('schedule-install')
    const btnUninstall = document.getElementById('schedule-uninstall')
    const btnSave = document.getElementById('schedule-save')
    const inputOnCalendar = document.getElementById('schedule-oncalendar')
    const btnWebuiInstall = document.getElementById('schedule-webui-install')
    const btnWebuiUninstall = document.getElementById('schedule-webui-uninstall')

    if (sched.mode === 'docker') {
        title.textContent = '定时任务 (Docker cron)'
        hint.innerHTML = 'Docker 模式下这里展示的是容器里的 cron 配置。要改时间请编辑 <code>compose.yaml</code> 或 <code>.env</code> 里的 <code>CRON_SCHEDULE</code> / <code>RUN_ON_START</code>，这里保留“立即触发一次”。'
        const r = sched.reward
        document.getElementById('schedule-reward-dl').innerHTML = `
            <dt>模式</dt><dd>Docker cron</dd>
            <dt>当前运行</dt><dd>${r.active ? '✅' : '❌'}</dd>
            <dt>Cron 表达式</dt><dd>${escapeHtml(r.onCalendar || '未设置')}</dd>
            <dt>启动即跑</dt><dd>${r.runOnStart ? '✅' : '❌'}</dd>
        `
        inputOnCalendar.value = r.onCalendar || ''
        inputOnCalendar.disabled = true
        btnInstall.classList.add('hidden')
        btnUninstall.classList.add('hidden')
        btnSave.classList.add('hidden')

        const w = sched.webui
        document.getElementById('schedule-webui-dl').innerHTML = `
            <dt>已启用</dt><dd>${w.enabled ? '✅' : '❌'}</dd>
            <dt>当前运行</dt><dd>${w.active ? '✅' : '❌'}</dd>
            <dt>监听地址</dt><dd>${escapeHtml(`${w.host}:${w.port}`)}</dd>
            <dt>Bearer 鉴权</dt><dd>${w.tokenProtected ? '✅ 已开启' : '⚠️ 未开启'}</dd>
        `
        btnWebuiInstall.classList.add('hidden')
        btnWebuiUninstall.classList.add('hidden')
        journalCard.classList.add('hidden')
        webuiCard.classList.remove('hidden')
        return
    }

    title.textContent = '定时任务 (systemd user timer)'
    hint.innerHTML = '让脚本每天自动跑。仅 Linux 可用。关机后还想触发需要 <code>sudo loginctl enable-linger $USER</code> 一次。'
    inputOnCalendar.disabled = false
    btnInstall.classList.remove('hidden')
    btnUninstall.classList.remove('hidden')
    btnSave.classList.remove('hidden')
    btnWebuiInstall.classList.remove('hidden')
    btnWebuiUninstall.classList.remove('hidden')
    webuiCard.classList.remove('hidden')
    journalCard.classList.remove('hidden')

    const r = sched.reward
    document.getElementById('schedule-reward-dl').innerHTML = `
        <dt>已安装</dt><dd>${r.timerInstalled ? '✅' : '❌'}</dd>
        <dt>已启用</dt><dd>${r.enabled ? '✅' : '❌'}</dd>
        <dt>正在运行</dt><dd>${r.active ? '✅' : '❌'}</dd>
        <dt>OnCalendar</dt><dd>${escapeHtml(r.onCalendar || '—')}</dd>
        <dt>下次触发</dt><dd>${escapeHtml(r.nextRun || '—')}</dd>
        <dt>unit 目录</dt><dd>${escapeHtml(sched.unitDir)}</dd>
        <dt>enable-linger</dt><dd>${sched.linger ? '✅ 已开（关机后也触发）' : '⚠️ 未开（关机后不触发，需 sudo loginctl enable-linger $USER）'}</dd>
    `
    document.getElementById('schedule-oncalendar').value = r.onCalendar || '*-*-* 07:00:00'

    const w = sched.webui
    document.getElementById('schedule-webui-dl').innerHTML = `
        <dt>已安装</dt><dd>${w.installed ? '✅' : '❌'}</dd>
        <dt>已启用 (开机自启)</dt><dd>${w.enabled ? '✅' : '❌'}</dd>
        <dt>当前运行</dt><dd>${w.active ? '✅' : '❌'}</dd>
    `
}

document.getElementById('btn-schedule-refresh').addEventListener('click', loadSchedule)
document.getElementById('schedule-install').addEventListener('click', async () => {
    try {
        const onCalendar = document.getElementById('schedule-oncalendar').value || '*-*-* 07:00:00'
        await api('/api/systemd/install', { method: 'POST', body: { onCalendar } })
        toast('已安装并启用 timer', 'ok')
        loadSchedule()
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})
document.getElementById('schedule-uninstall').addEventListener('click', async () => {
    if (!confirm('卸载定时 timer？脚本不会再自动运行。')) return
    try {
        await api('/api/systemd/uninstall', { method: 'POST', body: {} })
        toast('已卸载', 'ok')
        loadSchedule()
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})
document.getElementById('schedule-save').addEventListener('click', async () => {
    const onCalendar = document.getElementById('schedule-oncalendar').value.trim()
    if (!onCalendar) return
    try {
        await api('/api/systemd/schedule', { method: 'PUT', body: { onCalendar } })
        toast('已更新', 'ok')
        loadSchedule()
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})
document.getElementById('schedule-trigger').addEventListener('click', async () => {
    try {
        await api('/api/systemd/trigger', { method: 'POST', body: {} })
        toast('已触发，日志用 journalctl --user -u microsoft-rewards 查看', 'ok')
        setTimeout(loadSchedule, 1000)
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})
document.getElementById('schedule-webui-install').addEventListener('click', async () => {
    if (!confirm('把管理页本身注册为 systemd user service？开机自启并自动重启。')) return
    try {
        await api('/api/systemd/webui/install', { method: 'POST', body: {} })
        toast('已安装，下次开机会自动启动', 'ok')
        loadSchedule()
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})
document.getElementById('schedule-webui-uninstall').addEventListener('click', async () => {
    if (!confirm('卸载管理页自启？当前这个进程不会被停，但下次就不会自启了。')) return
    try {
        await api('/api/systemd/webui/uninstall', { method: 'POST', body: {} })
        toast('已卸载', 'ok')
        loadSchedule()
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})
document.getElementById('schedule-journal-load').addEventListener('click', async () => {
    try {
        const { stdout } = await api('/api/systemd/journal?lines=200')
        document.getElementById('schedule-journal').textContent = stdout || '（无日志）'
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})

// ─────────────────────────────────────────────────────────────────────────────
// 历史日志 Tab
// ─────────────────────────────────────────────────────────────────────────────

let logHistSelected = null

async function loadLogHistory() {
    try {
        const data = await api('/api/log-files')
        renderLogHistory(data)
    } catch (err) {
        toast(`加载历史日志失败: ${err.message}`, 'err')
    }
}

function renderLogHistory(data) {
    const tbody = document.getElementById('loghist-tbody')
    if (!data.files.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty">还没有日志文件</td></tr>'
        return
    }
    tbody.innerHTML = data.files
        .map(f => {
            const kb = (f.size / 1024).toFixed(1)
            const t = new Date(f.mtime).toLocaleString('zh-CN', { hour12: false })
            return `<tr data-name="${escapeAttr(f.name)}"><td>${escapeHtml(f.name)}</td><td>${kb} KB</td><td>${escapeHtml(t)}</td></tr>`
        })
        .join('')
    tbody.querySelectorAll('tr[data-name]').forEach(tr => {
        tr.addEventListener('click', () => viewLogFile(tr.dataset.name))
    })
}

async function viewLogFile(name) {
    logHistSelected = name
    document.getElementById('loghist-selected-name').textContent = name
    const dl = document.getElementById('loghist-download')
    const del = document.getElementById('loghist-delete')
    const token = getToken()
    dl.dataset.name = name
    dl.href = token ? '#' : `/api/log-files/${encodeURIComponent(name)}?download=1`
    dl.classList.remove('hidden')
    del.classList.remove('hidden')
    try {
        const data = await api(`/api/log-files/${encodeURIComponent(name)}?tailBytes=262144`)
        const prefix = data.truncated ? `... (只显示末尾 ${data.content.length} / ${data.size} 字节)\n\n` : ''
        document.getElementById('loghist-content').textContent = prefix + data.content
    } catch (err) {
        toast(`读取失败: ${err.message}`, 'err')
    }
}

document.getElementById('btn-loghist-refresh').addEventListener('click', loadLogHistory)
document.getElementById('loghist-download').addEventListener('click', async event => {
    const name = event.currentTarget.dataset.name
    if (!name || !getToken()) return
    event.preventDefault()
    try {
        const filename = await downloadBlobWithAuth(`/api/log-files/${encodeURIComponent(name)}?download=1`, name)
        toast(`已下载 ${filename}`, 'ok')
    } catch (err) {
        toast(`下载失败: ${err.message}`, 'err')
    }
})
document.getElementById('btn-loghist-clear').addEventListener('click', async () => {
    if (!confirm('确认清空所有历史日志？此操作不可撤销。')) return
    try {
        const { deleted } = await api('/api/log-files', { method: 'DELETE' })
        toast(`已删除 ${deleted} 个文件`, 'ok')
        document.getElementById('loghist-content').textContent = ''
        document.getElementById('loghist-selected-name').textContent = '请选择一个文件'
        document.getElementById('loghist-download').classList.add('hidden')
        document.getElementById('loghist-delete').classList.add('hidden')
        loadLogHistory()
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})
document.getElementById('loghist-delete').addEventListener('click', async () => {
    if (!logHistSelected) return
    if (!confirm(`删除 ${logHistSelected}？`)) return
    try {
        await api(`/api/log-files/${encodeURIComponent(logHistSelected)}`, { method: 'DELETE' })
        toast('已删除', 'ok')
        document.getElementById('loghist-content').textContent = ''
        document.getElementById('loghist-selected-name').textContent = '请选择一个文件'
        document.getElementById('loghist-download').classList.add('hidden')
        document.getElementById('loghist-delete').classList.add('hidden')
        logHistSelected = null
        loadLogHistory()
    } catch (err) {
        toast(`失败: ${err.message}`, 'err')
    }
})

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

initThemeToggle()
loadDashboard()

// Refresh status periodically
setInterval(loadDashboard, 15000)
