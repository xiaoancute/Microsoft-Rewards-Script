import ms, { StringValue } from 'ms'

export default class Util {
    async wait(time: number | string): Promise<void> {
        if (typeof time === 'string') {
            time = this.stringToNumber(time)
        }

        return new Promise<void>(resolve => {
            setTimeout(resolve, time)
        })
    }

    async waitRandom(min_ms: number, max_ms: number, distribution: 'uniform' | 'normal' = 'uniform'): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(resolve, this.randomNumber(min_ms, max_ms, distribution))
        })
    }

    getFormattedDate(ms = Date.now()): string {
        const today = new Date(ms)
        const month = String(today.getMonth() + 1).padStart(2, '0') //  一月是0
        const day = String(today.getDate()).padStart(2, '0')
        const year = today.getFullYear()

        return `${month}/${day}/${year}`
    }

    shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))

            const a = array[i]
            const b = array[j]

            if (a === undefined || b === undefined) continue

            array[i] = b
            array[j] = a
        }

        return array
    }

    randomNumber(
        min: number,
        max: number,
        distribution: 'uniform' | 'normal' | 'lognormal' = 'uniform'
    ): number {
        if (distribution === 'uniform') {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        if (distribution === 'lognormal') {
            // 长尾分布：多数值靠近中低位，偶尔接近 max。对应真人"连续快速浏览+偶尔停顿"
            // 用 Box-Muller 生成 N(0,1)，再 exp 得 lognormal(mu=0, sigma=0.35)
            // sigma=0.35: 约 90% 落在 [0.56*median, 1.78*median] 内，不会过度堆在边界
            // 中位数锚到 min + 0.4*range，尾巴自然拖向 max
            let u = 0, v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
            const lognorm = Math.exp(z * 0.35);
            const median = min + 0.4 * (max - min);
            const value = median * lognorm;
            return Math.max(min, Math.min(max, Math.floor(value)));
        }
        // 正态分布实现 (Box-Muller变换)
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        num = num / 10.0 + 0.5; // 标准化到0-1范围
        if (num > 1 || num < 0) num = this.randomNumber(min, max, distribution); // 边界处理
        return Math.floor(num * (max - min + 1)) + min;
    }

    chunkArray<T>(arr: T[], numChunks: number): T[][] {
        const chunkSize = Math.ceil(arr.length / numChunks)
        const chunks: T[][] = []

        for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.slice(i, i + chunkSize)
            chunks.push(chunk)
        }

        return chunks
    }

    stringToNumber(input: string | number): number {
        if (typeof input === 'number') {
            return input
        }
        const value = input.trim()

        const milisec = ms(value as StringValue)

        if (milisec === undefined) {
            throw new Error(
                `The input provided (${input}) cannot be parsed to a valid time! Use a format like "1 min", "1m" or "1 minutes"`
            )
        }

        return milisec
    }

    normalizeString(string: string): string {
        return string
            .normalize('NFD')
            .trim()
            .toLowerCase()
            .replace(/[^\x20-\x7E]/g, '')
            .replace(/[?!]/g, '')
    }

    getEmailUsername(email: string): string {
        return email.split('@')[0] ?? 'Unknown'
    }

    randomDelay(
        min: string | number,
        max: string | number,
        distribution: 'uniform' | 'normal' | 'lognormal' = 'uniform'
    ): number {
        const minMs = typeof min === 'number' ? min : this.stringToNumber(min)
        const maxMs = typeof max === 'number' ? max : this.stringToNumber(max)
        return Math.floor(this.randomNumber(minMs, maxMs, distribution))
    }

    /**
     * 把 "HH:MM" 解析成当天的 Date；如果 end 时刻早于 start，表示跨午夜，把 end 推到次日。
     * 返回 [startDate, endDate] 两个 Date，start <= end 保证。
     */
    private parseTimeWindow(start: string, end: string, baseline: Date): [Date, Date] {
        const parseHM = (s: string): [number, number] => {
            const [h, m] = s.split(':').map(Number)
            return [Math.max(0, Math.min(23, h || 0)), Math.max(0, Math.min(59, m || 0))]
        }
        const [sh, sm] = parseHM(start)
        const [eh, em] = parseHM(end)
        const s = new Date(baseline)
        s.setHours(sh, sm, 0, 0)
        const e = new Date(baseline)
        e.setHours(eh, em, 0, 0)
        if (e.getTime() <= s.getTime()) {
            // 跨午夜：end 推到次日
            e.setDate(e.getDate() + 1)
        }
        return [s, e]
    }

    /**
     * 计算从 now 开始、需要等到 quietHours 窗口结束的毫秒数；不在窗口内返回 0。
     * 支持跨午夜窗口（例如 23:00 -> 07:00）。
     */
    quietHoursWaitMs(quietHours: { enabled: boolean; start: string; end: string } | undefined, now = new Date()): number {
        if (!quietHours || !quietHours.enabled) return 0
        // 分两种 baseline：今天的窗口 + 昨天的窗口（用来覆盖"现在处在跨午夜窗口的后半段"的情形）
        const candidates: Array<[Date, Date]> = []
        candidates.push(this.parseTimeWindow(quietHours.start, quietHours.end, now))
        const yesterday = new Date(now)
        yesterday.setDate(yesterday.getDate() - 1)
        candidates.push(this.parseTimeWindow(quietHours.start, quietHours.end, yesterday))

        for (const [s, e] of candidates) {
            if (now.getTime() >= s.getTime() && now.getTime() < e.getTime()) {
                return e.getTime() - now.getTime()
            }
        }
        return 0
    }
}
