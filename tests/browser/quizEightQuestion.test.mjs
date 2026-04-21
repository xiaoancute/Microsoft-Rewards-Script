import test from 'node:test'
import assert from 'node:assert/strict'

async function loadQuiz() {
    const mod = await import('../../dist/functions/activities/api/Quiz.js')
    return mod.Quiz
}

function createQuizBot() {
    return {
        isMobile: false,
        userData: {
            currentPoints: 100,
            gainedPoints: 0
        },
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        },
        browser: {
            func: {
                buildCookieHeader() {
                    return 'cookie=1'
                },
                async getCurrentPoints() {
                    return 110
                }
            },
            utils: {
                async ghostClick() {
                    return true
                }
            }
        },
        fingerprint: {
            headers: {}
        },
        utils: {
            async wait() {},
            randomDelay() {
                return 0
            }
        },
        axios: {
            async request() {
                throw new Error('standard API path should not run for 8-question quiz')
            }
        },
        cookies: {
            mobile: [],
            desktop: []
        }
    }
}

test('Quiz.doQuiz uses browser flow for 8-question quizzes', async () => {
    const Quiz = await loadQuiz()
    const bot = createQuizBot()
    const quiz = new Quiz(bot)
    let browserFlowCalls = 0

    quiz.runEightQuestionQuiz = async function runEightQuestionQuiz() {
        browserFlowCalls++
        this.bot.userData.currentPoints = 110
        this.bot.userData.gainedPoints = 10
    }

    await quiz.doQuiz(
        {
            offerId: 'quiz-8',
            title: '8-question quiz',
            promotionType: 'quiz',
            pointProgressMax: 10,
            activityProgressMax: 80,
            destinationUrl: 'https://rewards.bing.com/quiz-8'
        },
        { tag: 'page' }
    )

    assert.equal(browserFlowCalls, 1)
    assert.equal(bot.userData.currentPoints, 110)
})

test('Quiz.doQuiz keeps ReportActivity flow for standard quizzes', async () => {
    const Quiz = await loadQuiz()
    const bot = createQuizBot()
    let requests = 0
    bot.axios.request = async () => {
        requests++
        return { status: 200 }
    }

    const quiz = new Quiz(bot)
    quiz.runEightQuestionQuiz = async function runEightQuestionQuiz() {
        throw new Error('unexpected 8-question branch')
    }

    await quiz.doQuiz(
        {
            offerId: 'quiz-30',
            title: 'standard quiz',
            promotionType: 'quiz',
            pointProgressMax: 30,
            activityProgressMax: 30,
            destinationUrl: 'https://rewards.bing.com/quiz-30'
        },
        { tag: 'page' }
    )

    assert.equal(requests > 0, true)
})
