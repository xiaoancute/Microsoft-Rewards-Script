import { getSessionPath, loadCookies, loadFingerprint } from '../utils.js'

export async function getBrowserSessionState({ runtimeBase, sessionPath, email, saveFingerprint }) {
    const sessionBase = getSessionPath(runtimeBase, sessionPath, email)

    let cookies = await loadCookies(sessionBase, 'desktop')
    let sessionType = 'desktop'

    if (cookies.length === 0) {
        const mobileCookies = await loadCookies(sessionBase, 'mobile')
        if (mobileCookies.length > 0) {
            cookies = mobileCookies
            sessionType = 'mobile'
        }
    }

    const isExistingSession = cookies.length > 0
    const isMobile = sessionType === 'mobile'
    const fingerprintEnabled = isMobile ? saveFingerprint?.mobile : saveFingerprint?.desktop

    let fingerprint = null
    if (isExistingSession && fingerprintEnabled) {
        fingerprint = await loadFingerprint(sessionBase, sessionType)
    }

    return {
        sessionBase,
        sessionType,
        isExistingSession,
        isMobile,
        fingerprintEnabled,
        cookies,
        fingerprint
    }
}
