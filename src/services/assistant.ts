import OpenAI from 'openai'
import { createTask, getTasksForDate, deleteTask, markTaskAsDone } from './tasks.js'
import { getLogs, deployProject, restartService, getStatus, runMaintenanceCommand, PROJECTS } from './deploy.js'
import { getResourceUsage, getSecurityOverview } from './infra.js'
import { format } from 'date-fns'

const PROJECT_NAMES = Object.keys(PROJECTS) as (keyof typeof PROJECTS)[]

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'createTask',
      description: 'Cria uma nova tarefa/compromisso na agenda do usuário',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título da tarefa' },
          datetime: { type: 'string', description: 'Data e hora no formato YYYY-MM-DD HH:mm' },
        },
        required: ['title', 'datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTasksForDate',
      description: 'Busca as tarefas de uma data específica',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteTask',
      description: 'Remove uma tarefa pelo ID',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'number', description: 'ID da tarefa a ser removida' },
        },
        required: ['taskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'markTaskAsDone',
      description: 'Marca uma tarefa como concluída',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'number', description: 'ID da tarefa concluída' },
        },
        required: ['taskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getStatus',
      description: 'Verifica a saúde/status dos containers de um projeto na VPS, ou de todos se nenhum projeto for informado',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', enum: PROJECT_NAMES, description: 'Qual projeto (omitir para ver todos)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getProjectLogs',
      description: 'Busca os logs recentes de um serviço de um projeto na VPS',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', enum: PROJECT_NAMES, description: 'Qual projeto' },
          service: { type: 'string', description: 'Nome do serviço/container (ex: radarodd-api, financas-web)' },
          lines: { type: 'number', description: 'Quantidade de linhas de log (padrão 50)' },
        },
        required: ['project', 'service'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deployProject',
      description: 'Faz deploy de um projeto na VPS (git pull + rebuild dos containers). Ação sensível, requer confirmação prévia do usuário.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', enum: PROJECT_NAMES, description: 'Qual projeto' },
        },
        required: ['project'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'restartService',
      description: 'Reinicia um serviço/container de um projeto na VPS. Ação sensível, requer confirmação prévia do usuário.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', enum: PROJECT_NAMES, description: 'Qual projeto' },
          service: { type: 'string', description: 'Nome do serviço/container a reiniciar' },
        },
        required: ['project', 'service'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runMaintenanceCommand',
      description: 'Executa um comando de manutenção pré-definido (ex: migrate, seed) em um projeto na VPS. Ação sensível, requer confirmação prévia do usuário.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', enum: PROJECT_NAMES, description: 'Qual projeto' },
          command: { type: 'string', description: 'Nome do comando de manutenção (ex: migrate, seed)' },
        },
        required: ['project', 'command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getResourceUsage',
      description: 'Verifica uso de CPU, memória e disco da VPS, e o consumo de cada container. Útil pra saber se cabe mais um projeto.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSecurityOverview',
      description: 'Lista portas escutando publicamente na VPS e as portas expostas por cada container',
      parameters: { type: 'object', properties: {} },
    },
  },
]

type PendingAction = {
  type: 'deployProject' | 'restartService' | 'runMaintenanceCommand'
  project: string
  service?: string
  command?: string
}

const pendingActions = new Map<number, PendingAction>()
const conversationHistory = new Map<number, OpenAI.Chat.ChatCompletionMessageParam[]>()

const SYSTEM_PROMPT = `Você é um assistente pessoal de agenda via Telegram.
Hoje é ${format(new Date(), 'yyyy-MM-dd')} (formato YYYY-MM-DD).
Seja breve, direto e use emojis com moderação.
Quando o usuário mencionar datas relativas (hoje, amanhã, segunda-feira), calcule a data exata.
Sempre confirme a ação realizada de forma natural, sem mencionar nomes de funções ou termos técnicos.`

const CONFIRMATION_WORDS = ['sim', 's', 'confirmo', 'confirmar', 'yes']

export async function processMessage(chatId: number, userMessage: string): Promise<string> {
  const pending = pendingActions.get(chatId)

  if (pending) {
    pendingActions.delete(chatId)

    if (CONFIRMATION_WORDS.includes(userMessage.trim().toLowerCase())) {
      try {
        return await runPendingAction(pending)
      } catch (error) {
        return `❌ Falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`
      }
    }

    return '🚫 Ação cancelada.'
  }

  if (!conversationHistory.has(chatId)) {
    conversationHistory.set(chatId, [{ role: 'system', content: SYSTEM_PROMPT }])
  }

  const history = conversationHistory.get(chatId)!
  history.push({ role: 'user', content: userMessage })

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: history,
    tools,
  })

  const message = response.choices[0]?.message

  if (!message) {
    return '❌ Não consegui processar isso, tenta de novo?'
  }

  // Se o GPT decidiu chamar uma função
  if (message.tool_calls && message.tool_calls.length > 0) {
    history.push(message)

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') continue

      const result = await executeFunction(chatId, toolCall.function.name, JSON.parse(toolCall.function.arguments))

      history.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      })
    }

    // Manda de volta pro GPT formular a resposta final com o resultado
    const finalResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: history,
    })

    const finalMessage = finalResponse.choices[0]?.message.content ?? 'Pronto!'
    history.push({ role: 'assistant', content: finalMessage })
    return finalMessage
  }

  // Resposta direta, sem função
  const directReply = message.content ?? 'Não entendi, pode reformular?'
  history.push({ role: 'assistant', content: directReply })
  return directReply
}

async function executeFunction(chatId: number, name: string, args: any) {
  try {
    return await runFunction(chatId, name, args)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

async function runFunction(chatId: number, name: string, args: any) {
  switch (name) {
    case 'createTask':
      return await createTask({ title: args.title, datetime: args.datetime })
    case 'getTasksForDate':
      return await getTasksForDate(args.date)
    case 'deleteTask':
      return await deleteTask(args.taskId)
    case 'markTaskAsDone':
      return await markTaskAsDone(args.taskId)
    case 'getStatus':
      return await getStatus(args.project)
    case 'getProjectLogs':
      return await getLogs(args.project, args.service, args.lines)
    case 'deployProject':
      pendingActions.set(chatId, { type: 'deployProject', project: args.project })
      return { pending: true, message: `Confirma o deploy de ${args.project}? Responda "sim" para continuar.` }
    case 'restartService':
      pendingActions.set(chatId, { type: 'restartService', project: args.project, service: args.service })
      return { pending: true, message: `Confirma o restart de ${args.service} (${args.project})? Responda "sim" para continuar.` }
    case 'runMaintenanceCommand':
      pendingActions.set(chatId, { type: 'runMaintenanceCommand', project: args.project, command: args.command })
      return { pending: true, message: `Confirma rodar "${args.command}" em ${args.project}? Responda "sim" para continuar.` }
    case 'getResourceUsage':
      return await getResourceUsage()
    case 'getSecurityOverview':
      return await getSecurityOverview()
    default:
      return { error: 'Função desconhecida' }
  }
}

async function runPendingAction(pending: PendingAction): Promise<string> {
  if (pending.type === 'deployProject') {
    const result = await deployProject(pending.project)
    return `✅ Deploy de ${pending.project} concluído.\n\n${result.stdout}`
  }

  if (pending.type === 'runMaintenanceCommand') {
    const result = await runMaintenanceCommand(pending.project, pending.command!)
    return `✅ "${pending.command}" executado em ${pending.project}.\n\n${result.stdout}`
  }

  const result = await restartService(pending.project, pending.service!)
  return `✅ ${pending.service} (${pending.project}) reiniciado.\n\n${result}`
}