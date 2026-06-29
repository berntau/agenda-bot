import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { Telegraf } from 'telegraf'

const execAsync = promisify(exec)

// ---------------------------------------------------------------------------
// Container monitor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Evolution API monitor
//
// Detecta mudanças de estado nas instâncias WhatsApp. Quando o estado vai
// para "qr", busca a imagem e manda direto no Telegram para scan imediato —
// sem precisar abrir nenhum painel.
//
// Configuração (variáveis de ambiente no .env do agenda-bot):
//   EVOLUTION_GALDINO_URL     → URL da API (padrão: http://localhost:8081)
//   EVOLUTION_GALDINO_API_KEY → chave de autenticação (AUTHENTICATION_API_KEY
//                               do docker-compose.automation.yml)
// ---------------------------------------------------------------------------

type EvolutionConfig = {
  label: string
  url: string
  apiKey: string
}

type EvolutionInstance = {
  instance: { instanceName: string; state: string }
}

// Estado anterior por "label/instanceName" para detectar mudanças
const previousInstanceStates = new Map<string, string>()

function getEvolutionConfigs(): EvolutionConfig[] {
  const configs: EvolutionConfig[] = []
  const galdinoKey = process.env.EVOLUTION_GALDINO_API_KEY
  if (galdinoKey) {
    configs.push({
      label: 'galdino-automation',
      url: process.env.EVOLUTION_GALDINO_URL ?? 'http://localhost:8081',
      apiKey: galdinoKey,
    })
  }
  return configs
}

async function fetchEvolutionInstances(config: EvolutionConfig): Promise<EvolutionInstance[]> {
  const resp = await fetch(`${config.url}/instance/fetchInstances`, {
    headers: { apikey: config.apiKey },
    signal: AbortSignal.timeout(10000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json() as Promise<EvolutionInstance[]>
}

async function fetchQrImage(config: EvolutionConfig, instanceName: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(`${config.url}/instance/qrcode/${instanceName}`, {
      headers: { apikey: config.apiKey },
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { base64?: string }
    if (!data.base64) return null
    const b64 = data.base64.replace(/^data:image\/\w+;base64,/, '')
    return Buffer.from(b64, 'base64')
  } catch {
    return null
  }
}

async function checkEvolutionInstances(bot: Telegraf, chatId: number) {
  for (const config of getEvolutionConfigs()) {
    let instances: EvolutionInstance[]
    const apiKey = `${config.label}/__api__`

    try {
      instances = await fetchEvolutionInstances(config)
      // API respondeu — limpa alerta de indisponibilidade se havia um
      if (previousInstanceStates.get(apiKey) === 'unreachable') {
        previousInstanceStates.delete(apiKey)
        await bot.telegram.sendMessage(chatId, `✅ Evolution API (${config.label}) voltou a responder`)
      }
    } catch {
      if (previousInstanceStates.get(apiKey) !== 'unreachable') {
        previousInstanceStates.set(apiKey, 'unreachable')
        await bot.telegram.sendMessage(
          chatId,
          `🔴 Evolution API (${config.label}) não está respondendo — container pode estar travado`,
        )
      }
      continue
    }

    for (const { instance } of instances) {
      const key = `${config.label}/${instance.instanceName}`
      const prevState = previousInstanceStates.get(key)
      const state = instance.state

      previousInstanceStates.set(key, state)

      if (state === prevState) continue // sem mudança, nada a notificar

      if (state === 'open') {
        if (prevState !== undefined) {
          await bot.telegram.sendMessage(
            chatId,
            `✅ WhatsApp conectado: ${instance.instanceName} (${config.label})`,
          )
        }
        continue
      }

      // Estado problemático — monta mensagem de acordo
      const stateLabels: Record<string, string> = {
        qr: 'aguardando scan do QR code',
        close: 'desconectado',
        connecting: 'tentando reconectar',
        disconnected: 'desconectado',
        forbidden: 'conta banida/bloqueada pelo WhatsApp',
      }
      const label = stateLabels[state] ?? state

      await bot.telegram.sendMessage(
        chatId,
        `⚠️ WhatsApp (${config.label} / ${instance.instanceName}): ${label}`,
      )

      // Se é QR, manda a imagem direto pro chat para scan imediato
      if (state === 'qr') {
        const qrBuffer = await fetchQrImage(config, instance.instanceName)
        if (qrBuffer) {
          await bot.telegram.sendPhoto(chatId, { source: qrBuffer })
        }
      }
    }
  }
}

export function startEvolutionMonitor(bot: Telegraf, chatId: number, intervalMs = 120000) {
  if (getEvolutionConfigs().length === 0) return // sem configuração, não inicia

  setInterval(async () => {
    try {
      await checkEvolutionInstances(bot, chatId)
    } catch {
      // Falha isolada não derruba o monitor
    }
  }, intervalMs)
}
