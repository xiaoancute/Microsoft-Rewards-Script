import test from 'node:test'
import assert from 'node:assert/strict'

async function loadQuiz() {
    const mod = await import('../../dist/functions/activities/api/Quiz.js')
    return mod.Quiz
}

function createQuizBot() {
    return {
        isMobile: false,
        currentAccountEmail: 'quiz@example.com',
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
                async assertNoRiskControlPrompt() {},
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

test('Quiz.doQuiz runs real 8-question helper with navigation and resilient candidate progression', async () => {
    const Quiz = await loadQuiz()
    const bot = createQuizBot()
    bot.browser.func.getCurrentPoints = async () => 100
    const quiz = new Quiz(bot)
    const clickOrder = []
    const navigations = []
    const state = {
        currentUrl: 'https://rewards.bing.com/dashboard',
        questionIndex: 0
    }

    function makeLocator(selector) {
        if (selector === 'input[type="radio"]') {
            return {
                async count() {
                    if (state.questionIndex >= 8) return 0
                    return 2
                },
                nth(index) {
                    return {
                        async click() {
                            clickOrder.push(`${state.questionIndex}:${index}`)
                            if (index === 0) {
                                throw new Error('stale option')
                            }
                            state.questionIndex++
                        }
                    }
                },
                first() {
                    return this.nth(0)
                }
            }
        }

        if (selector === '[data-quiz-question-id]') {
            return {
                async count() {
                    return state.questionIndex >= 8 ? 0 : 1
                },
                first() {
                    return {
                        async innerText() {
                            return `q-${state.questionIndex}`
                        }
                    }
                }
            }
        }

        return {
            async count() {
                return 0
            },
            nth() {
                return {
                    async click() {
                        return undefined
                    }
                }
            },
            first() {
                return this.nth(0)
            }
        }
    }

    const page = {
        url() {
            return state.currentUrl
        },
        async goto(url) {
            navigations.push(url)
            state.currentUrl = url
        },
        locator(selector) {
            return makeLocator(selector)
        }
    }

    await quiz.doQuiz(
        {
            offerId: 'quiz-8-real',
            title: '8-question quiz real helper',
            promotionType: 'quiz',
            pointProgressMax: 10,
            activityProgressMax: 80,
            destinationUrl: 'https://rewards.bing.com/quiz-8-real'
        },
        page
    )

    assert.deepEqual(navigations, ['https://rewards.bing.com/quiz-8-real'])
    assert.equal(state.questionIndex, 8)
    assert.equal(clickOrder.includes('0:0'), true)
    assert.equal(clickOrder.includes('0:1'), true)
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

    assert.equal(requests, 2)
})

test('Quiz.doQuiz uses browser fallback for blank-offerId standard quizzes', async () => {
    const Quiz = await loadQuiz()
    const bot = createQuizBot()
    let requests = 0
    bot.axios.request = async () => {
        requests++
        return { status: 200 }
    }

    const quiz = new Quiz(bot)
    let browserFlowCalls = 0
    quiz.runBrowserQuiz = async function runBrowserQuiz() {
        browserFlowCalls++
        this.bot.userData.currentPoints = 110
        this.bot.userData.gainedPoints = 10
    }

    await quiz.doQuiz(
        {
            offerId: '   ',
            title: 'blank standard quiz',
            promotionType: 'quiz',
            pointProgressMax: 30,
            activityProgressMax: 30,
            destinationUrl: 'https://rewards.bing.com/quiz-standard'
        },
        { tag: 'page' }
    )

    assert.equal(browserFlowCalls, 1)
    assert.equal(requests, 0)
    assert.equal(bot.userData.currentPoints, 110)
})
