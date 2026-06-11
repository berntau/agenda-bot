import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  datetime: text('datetime').notNull(),
  isDone: integer('is_done', { mode: 'boolean' }).notNull().default(false),
  remindMinutesBefore: integer('remind_minutes_before').notNull().default(15),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const recurrences = sqliteTable('recurrences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  rule: text('rule').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
})