import OpenAI from 'openai'
import { createTask, getTasksForDate, deleteTask, markTaskAsDone } from './tasks.js'
import { format } from 'date-fns'

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
]

const conversationHistory = new Map<number, OpenAI.Chat.ChatCompletionMessageParam[]>()

const SYSTEM_PROMPT = `Você é um assistente pessoal de agenda via Telegram.
Hoje é ${format(new Date(), 'yyyy-MM-dd')} (formato YYYY-MM-DD).
Seja breve, direto e use emojis com moderação.
Quando o usuário mencionar datas relativas (hoje, amanhã, segunda-feira), calcule a data exata.
Sempre confirme a ação realizada de forma natural, sem mencionar nomes de funções ou termos técnicos.`

export async function processMessage(chatId: number, userMessage: string): Promise<string> {
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

      const result = await executeFunction(toolCall.function.name, JSON.parse(toolCall.function.arguments))

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

async function executeFunction(name: string, args: any) {
  switch (name) {
    case 'createTask':
      return await createTask({ title: args.title, datetime: args.datetime })
    case 'getTasksForDate':
      return await getTasksForDate(args.date)
    case 'deleteTask':
      return await deleteTask(args.taskId)
    case 'markTaskAsDone':
      return await markTaskAsDone(args.taskId)
    default:
      return { error: 'Função desconhecida' }
  }
}