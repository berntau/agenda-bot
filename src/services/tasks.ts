import { db } from '../db/client.js'
import { tasks, recurrences } from '../db/schema.js'
import { eq, and, like } from 'drizzle-orm'

export type CreateTaskInput = {
  title: string
  datetime: string
  remindMinutesBefore?: number
  recurrenceRule?: string
}

export async function createTask(input: CreateTaskInput) {
  const [task] = await db
    .insert(tasks)
    .values({
      title: input.title,
      datetime: input.datetime,
      remindMinutesBefore: input.remindMinutesBefore ?? 15,
    })
    .returning()

  if (input.recurrenceRule && task) {
    await db.insert(recurrences).values({
      taskId: task.id,
      rule: input.recurrenceRule,
      active: true,
    })
  }

  return task
}

export async function getTasksForDate(date: string) {
  return db
    .select()
    .from(tasks)
    .where(and(like(tasks.datetime, `${date}%`), eq(tasks.isDone, false)))
}

export async function markTaskAsDone(taskId: number) {
  return db
    .update(tasks)
    .set({ isDone: true })
    .where(eq(tasks.id, taskId))
}

export async function deleteTask(taskId: number) {
  return db
    .delete(tasks)
    .where(eq(tasks.id, taskId))
}