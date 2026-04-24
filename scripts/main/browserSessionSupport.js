import { getSessionPath, getSessionPathCandidates, loadCookies, loadFingerprint } from '../utils.js'

export async function getBrowserSessionState({ projectRoot, sessionPath, email, saveFingerprint }) {
    const sessionBase = getSessionPath(projectRoot, sessionPath, email)
    const sessionCandidates = getSessionPathCandidates(projectRoot, sessionPath, email)

    let sourceSessionBase = sessionBase
    let cookies = []
    let sessionType = 'desktop'

    for (const candidate of sessionCandidates) {
        const desktopCookies = await loadCookies(candidate, 'desktop')
        if (desktopCookies.length > 0) {
            sourceSessionBase = candidate
            cookies = desktopCookies
            sessionType = 'desktop'
            break
        }

        const mobileCookies = await loadCookies(candidate, 'mobile')
        if (mobileCookies.length > 0) {
            sourceSessionBase = candidate
            cookies = mobileCookies
            sessionType = 'mobile'
            break
        }
    }

    const isExistingSession = cookies.length > 0
    const isMobile = sessionType === 'mobile'
    const fingerprintEnabled = isMobile ? saveFingerprint?.mobile : saveFingerprint?.desktop

    let fingerprint = null
    if (isExistingSession && fingerprintEnabled) {
        fingerprint = await loadFingerprint(sourceSessionBase, sessionType)
    }

    return {
        sessionBase,
        sourceSessionBase,
        sessionType,
        isExistingSession,
        isMobile,
        fingerprintEnabled,
        cookies,
        fingerprint
    }
}
