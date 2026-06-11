import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import dotenv from 'dotenv'

dotenv.config()

const sqlite = new Database(process.env.DATABASE_URL ?? './agenda.db')

sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })