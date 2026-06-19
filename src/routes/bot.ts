import { Telegraf } from 'telegraf'
import { createTask, getTasksForDate, deleteTask, markTaskAsDone } from '../services/tasks.js'
import { format } from 'date-fns'
import { processMessage } from '../services/assistant.js'
const bot = new Telegraf(process.env.TELEGRAM_TOKEN!)

const AUTHORIZED_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID)

bot.use((ctx, next) => {
  if (ctx.chat?.id !== AUTHORIZED_CHAT_ID) {
    return ctx.reply('⛔ Acesso não autorizado.')
  }
  return next()
})

bot.command('start', (ctx) => {
  ctx.reply(`👋 Olá! Sou seu bot de agenda pessoal.

Comandos disponíveis:
/adicionar [tarefa] [data] [hora] — Adiciona uma tarefa
/hoje — Lista as tarefas de hoje
/cancelar [id] — Remove uma tarefa
/feito [id] — Marca tarefa como concluída

Exemplo:
/adicionar Reunião com cliente 2026-06-11 14:00`)
})

bot.command('adicionar', async (ctx) => {
  const text = ctx.message.text.replace('/adicionar', '').trim()
  const parts = text.split(' ')

  const hora = parts[parts.length - 1]
  const data = parts[parts.length - 2]
  const titulo = parts.slice(0, parts.length - 2).join(' ')

  if (!titulo || !data || !hora) {
    return ctx.reply('❌ Formato inválido. Use:\n/adicionar Título da tarefa 2026-06-11 14:00')
  }

  const datetime = `${data} ${hora}`
  const task = await createTask({ title: titulo, datetime })

  ctx.reply(`✅ Tarefa criada!\n\n📌 ${task?.title}\n🕐 ${datetime}\n🔔 Lembrete: 15 min antes\n\nID: ${task?.id}`)
})

bot.command('hoje', async (ctx) => {
  const hoje = format(new Date(), 'yyyy-MM-dd')
  const tarefas = await getTasksForDate(hoje)

  if (tarefas.length === 0) {
    return ctx.reply('📭 Nenhuma tarefa para hoje!')
  }

  const lista = tarefas.map(t =>
    `📌 [${t.id}] ${t.title}\n🕐 ${t.datetime.split(' ')[1]}`
  ).join('\n\n')

  ctx.reply(`📅 *Tarefas de hoje:*\n\n${lista}`, { parse_mode: 'Markdown' })
})

bot.command('cancelar', async (ctx) => {
  const text = ctx.message.text.replace('/cancelar', '').trim()
  const id = Number(text)

  if (isNaN(id)) {
    return ctx.reply('❌ Informe o ID da tarefa. Use:\n/cancelar 1')
  }

  await deleteTask(id)
  ctx.reply(`🗑️ Tarefa ${id} removida!`)
})

bot.command('feito', async (ctx) => {
  const text = ctx.message.text.replace('/feito', '').trim()
  const id = Number(text)

  if (isNaN(id)) {
    return ctx.reply('❌ Informe o ID da tarefa. Use:\n/feito 1')
  }

  await markTaskAsDone(id)
  ctx.reply(`✅ Tarefa ${id} marcada como concluída!`)
})
bot.on('text', async (ctx) => {
  const text = ctx.message.text

  // Ignora se for um comando (já tratado acima)
  if (text.startsWith('/')) return

  const chatId = ctx.chat.id

  // Mostra "digitando..." enquanto processa
  await ctx.sendChatAction('typing')

  const reply = await processMessage(chatId, text)
  await ctx.reply(reply)
})
export default bot