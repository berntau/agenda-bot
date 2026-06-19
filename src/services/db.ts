import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { PROJECTS } from './deploy.js'

const execAsync = promisify(exec)

const DB_PROJECTS = {
  financas: { service: 'financas-db', user: 'financas', database: 'financas' },
  radarodd: { service: 'radarodd-db', user: 'radar', database: 'radarodd' },
  imobvellor: { service: 'postgres', user: 'imobvellor', database: 'imobvellor' },
} as const

export const DB_PROJECT_NAMES = Object.keys(DB_PROJECTS) as (keyof typeof DB_PROJECTS)[]

// Operações de leitura/escrita de linhas são permitidas; mudanças de schema/permissão não.
const FORBIDDEN_SQL = /\b(drop|truncate|alter|grant|revoke|create|attach|vacuum|copy)\b/i

function getDbProjectOrThrow(projectName: string) {
  if (!(projectName in DB_PROJECTS)) {
    throw new Error(`Projeto sem banco configurado: ${projectName}`)
  }
  return DB_PROJECTS[projectName as keyof typeof DB_PROJECTS]
}

async function runSql(projectName: string, sql: string) {
  const project = PROJECTS[projectName as keyof typeof PROJECTS]
  if (!project) throw new Error(`Projeto desconhecido: ${projectName}`)
  const db = getDbProjectOrThrow(projectName)

  const { stdout } = await execAsync(
    `docker compose -f ${project.path}/${project.compose} exec -T ${db.service} psql -U ${db.user} -d ${db.database} -t -A -c "${sql.replace(/"/g, '\\"')}"`
  )
  return stdout.trim()
}

export async function listTables(projectName: string) {
  return await runSql(projectName, "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;")
}

export async function describeTable(projectName: string, table: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
    throw new Error('Nome de tabela inválido')
  }

  return await runSql(
    projectName,
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position;`
  )
}

function sanitizeSql(sql: string) {
  const trimmed = sql.trim().replace(/;+$/, '')

  if (trimmed.includes(';')) {
    throw new Error('Só é permitido executar um comando SQL por vez')
  }

  if (FORBIDDEN_SQL.test(trimmed)) {
    throw new Error('Esse comando altera schema/permissões e não é permitido por aqui')
  }

  return trimmed
}

// Roda o comando dentro de uma transação que sempre é desfeita: serve pra validar
// contra o schema real (nomes de coluna/tabela) e descobrir quantas linhas seriam
// afetadas, sem aplicar nada de fato. Comandos UPDATE/DELETE/INSERT passam por aqui
// antes de pedir confirmação ao usuário.
export async function dryRunSqlCommand(projectName: string, sql: string) {
  const trimmed = sanitizeSql(sql)
  const output = await runSql(projectName, `BEGIN; ${trimmed}; ROLLBACK;`)

  const tagLine = output.split('\n').find((line) => /^(insert|update|delete)\b/i.test(line))
  const affectedRows = tagLine ? Number(tagLine.split(/\s+/).pop()) : undefined

  return { affectedRows }
}

export async function runSqlCommand(projectName: string, sql: string) {
  const trimmed = sanitizeSql(sql)
  return await runSql(projectName, `${trimmed};`)
}
