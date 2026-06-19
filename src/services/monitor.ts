import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { Telegraf } from 'telegraf'

const execAsync = promisify(exec)

const PROBLEM_PATTERN = /^Restarting|^Exited|\(unhealthy\)/

let previousProblems = new Map<string, string>()

async function checkContainers() {
  const { stdout } = await execAsync('docker ps -a --format "{{.Names}}\t{{.Status}}"')

  const currentProblems = new Map<string, string>()
  for (const line of stdout.trim().split('\n')) {
    const [name, status] = line.split('\t')
    if (name && status && PROBLEM_PATTERN.test(status)) {
      currentProblems.set(name, status)
    }
  }

  const newProblems = [...currentProblems].filter(([name]) => !previousProblems.has(name))
  const recovered = [...previousProblems.keys()].filter((name) => !currentProblems.has(name))

  previousProblems = currentProblems

  return { newProblems, recovered }
}

export function startContainerMonitor(bot: Telegraf, chatId: number, intervalMs = 120000) {
  setInterval(async () => {
    try {
      const { newProblems, recovered } = await checkContainers()

      for (const [name, status] of newProblems) {
        await bot.telegram.sendMessage(chatId, `🔴 ${name} com problema: ${status}`)
      }

      for (const name of recovered) {
        await bot.telegram.sendMessage(chatId, `✅ ${name} voltou ao normal`)
      }
    } catch {
      // Falha ao checar não deve derrubar o monitor; tenta de novo no próximo ciclo
    }
  }, intervalMs)
}
