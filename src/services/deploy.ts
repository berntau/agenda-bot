import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export const PROJECTS = {
  radarodd: {
    path: '/home/taua/radarodd',
    compose: 'docker-compose.yml',
    services: ['radarodd-api', 'radarodd-web', 'radarodd-db'],
    commands: {
      migrate: { service: 'radarodd-api', exec: 'npm run migrate' },
      seed: { service: 'radarodd-api', exec: 'npm run seed' },
    },
  },
  financas: {
    path: '/home/taua/financas-ia',
    compose: 'docker-compose.yml',
    services: ['financas-web', 'financas-db'],
    commands: {
      migrate: { service: 'financas-web', exec: 'python manage.py migrate' },
    },
  },
  imobvellor: {
    path: '/home/taua/vellorimob',
    compose: 'deploy/docker-compose.imobvellor.yml',
    services: [
      'imobvellor-backend-1',
      'imobvellor-chatwoot-worker-1',
      'imobvellor-chatwoot-web-1',
      'imobvellor-n8n-1',
      'imobvellor-evolution-1',
      'imobvellor-redis-1',
      'imobvellor-postgres-1',
    ],
    commands: {
      migrate: { service: 'imobvellor-backend-1', exec: 'npm run migrate' },
    },
  },
  'anki-concursos': {
    path: '/home/taua/anki-concursos',
    compose: 'docker-compose.yml',
    services: ['web', 'api', 'db'],
    commands: {
      migrate: { service: 'api', exec: 'npm run migrate' },
    },
  },
  'galdino-concept': {
    path: '/home/taua/galdino-concept',
    compose: 'docker-compose.yml',
    services: ['web', 'api', 'db'],
    commands: {
      migrate: { service: 'api', exec: 'npm run migrate' },
      seed: { service: 'api', exec: 'npm run seed' },
    },
  },
  'galdino-automation': {
    path: '/home/taua/galdino-automation',
    compose: 'deploy/docker-compose.automation.yml',
    envFile: '.env.automation',
    services: ['evolution', 'n8n', 'postgres', 'redis', 'diun'],
    commands: {
      // Rebuilda a imagem custom do Evolution (Dockerfile local com Baileys atualizado)
      // e reinicia só esse serviço sem derrubar n8n/postgres/redis.
      'update-evolution': { rebuild: true, service: 'evolution' },
    },
  },
} as const

export type ProjectName = keyof typeof PROJECTS

type AnyProject = (typeof PROJECTS)[ProjectName]
type MaintenanceCommand = { service: string; exec: string } | { rebuild: true; service: string }

function getProjectName(projectName: string): ProjectName {
  if (!(projectName in PROJECTS)) {
    throw new Error(`Projeto desconhecido: ${projectName}`)
  }
  return projectName as ProjectName
}

function getProjectOrThrow(project: string) {
  return PROJECTS[getProjectName(project)]
}

function getServiceOrThrow(project: AnyProject, service: string) {
  if (!(project.services as readonly string[]).includes(service)) {
    throw new Error(`Serviço desconhecido: ${service}`)
  }
  return service
}

// Monta o prefixo `docker compose -f <path> [--env-file <file>]` para o projeto.
function composeCmd(project: AnyProject) {
  const base = `docker compose -f ${project.path}/${project.compose}`
  return 'envFile' in project ? `${base} --env-file ${project.path}/${project.envFile}` : base
}

export async function getLogs(projectName: string, serviceName: string, lines = 50) {
  const project = getProjectOrThrow(projectName)
  const service = getServiceOrThrow(project, serviceName)
  const safeLines = Number.isInteger(lines) && lines > 0 && lines <= 500 ? lines : 50

  const { stdout } = await execAsync(
    `${composeCmd(project)} logs --tail=${safeLines} ${service}`
  )

  return stdout.slice(-3000) // Limita o tamanho pra não quebrar o Telegram
}

export async function deployProject(projectName: string) {
  const project = getProjectOrThrow(projectName)
  const envFilePart = 'envFile' in project ? ` --env-file ${project.envFile}` : ''

  const { stdout, stderr } = await execAsync(
    `cd ${project.path} && git pull && docker compose -f ${project.compose}${envFilePart} up -d --build`,
    { timeout: 120000 } // 2 minutos de timeout
  )

  return { stdout: stdout.slice(-2000), stderr: stderr.slice(-1000) }
}

export async function restartService(projectName: string, serviceName: string) {
  const project = getProjectOrThrow(projectName)
  const service = getServiceOrThrow(project, serviceName)

  const { stdout } = await execAsync(`${composeCmd(project)} restart ${service}`)

  return stdout
}

export function getAvailableCommands(projectName: string) {
  const project = getProjectOrThrow(projectName)
  return Object.keys(project.commands)
}

export async function runMaintenanceCommand(projectName: string, commandName: string) {
  const project = getProjectOrThrow(projectName)
  const command = (project.commands as Record<string, MaintenanceCommand>)[commandName]

  if (!command) {
    throw new Error(`Comando desconhecido: ${commandName}`)
  }

  if ('rebuild' in command) {
    // Rebuilda a imagem local e reinicia só este serviço sem derrubar os demais.
    const { stdout, stderr } = await execAsync(
      `${composeCmd(project)} build ${command.service} && ${composeCmd(project)} up -d --no-deps ${command.service}`,
      { timeout: 300000 } // 5 minutos: build pode demorar
    )
    return { stdout: stdout.slice(-2000), stderr: stderr.slice(-1000) }
  }

  const { stdout, stderr } = await execAsync(
    `${composeCmd(project)} exec -T ${command.service} ${command.exec}`,
    { timeout: 120000 }
  )

  return { stdout: stdout.slice(-2000), stderr: stderr.slice(-1000) }
}

export async function getStatus(projectName?: string) {
  const projectNames = projectName ? [getProjectName(projectName)] : (Object.keys(PROJECTS) as ProjectName[])

  const results = await Promise.all(
    projectNames.map(async (name) => {
      const project = PROJECTS[name]
      const { stdout } = await execAsync(`${composeCmd(project)} ps --format "table {{.Name}}\t{{.Status}}"`)
      return `📦 ${name}:\n${stdout.trim()}`
    })
  )

  return results.join('\n\n')
}
