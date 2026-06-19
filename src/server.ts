import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import bot from './routes/bot.js'
import { startContainerMonitor } from './services/monitor.js'

dotenv.config()

const server = Fastify({ logger: true })

await server.register(cors, { origin: true })

server.get('/health', async () => {
  return { status: 'ok', message: 'AgendaBot online!' }
})

const port = Number(process.env.PORT) ?? 3000
await server.listen({ port, host: '127.0.0.1' })

bot.launch()

startContainerMonitor(bot, Number(process.env.TELEGRAM_CHAT_ID))

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))