import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { Telegraf } from 'telegraf'

dotenv.config()

const server = Fastify({ logger: true })

await server.register(cors, { origin: true })

const bot = new Telegraf(process.env.TELEGRAM_TOKEN!)

bot.on('message', (ctx) => {
  const chatId = ctx.chat.id
  ctx.reply(`Seu CHAT_ID é: ${chatId}`)
})

bot.launch()

server.get('/health', async () => {
  return { status: 'ok', message: 'AgendaBot online!' }
})

const port = Number(process.env.PORT) ?? 3000
await server.listen({ port, host: '0.0.0.0' })