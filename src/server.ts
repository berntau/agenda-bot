import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'

dotenv.config()

const server = Fastify({
    logger: true
})

await server.register(cors, {
    origin: true
})

server.get('/health', async () => {
    return { status: 'ok', message: 'Finapobre online'}
})

const port = Number(process.env.PORT) ?? 3000

await server.listen ({port, host: '0.0.0.0' })