import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export const PROJECTS = {
  radarodd: {
    path: '/home/taua/radarodd',
    compose: 'docker-compose.yml',
    services: ['radarodd-api', 'radarodd-web', 'radarodd-db'],
  },
  financas: {
    path: '/home/taua/financas-ia',
    compose: 'docker-compose.yml',
    services: ['financas-web', 'financas-db'],
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
  },
} as const

export type ProjectName = keyof typeof PROJECTS

function getProjectName(projectName: string): ProjectName {
  if (!(projectName in PROJECTS)) {
    throw new Error(`Projeto desconhecido: ${projectName}`)
  }
  return projectName as ProjectName
}

function getProjectOrThrow(project: string) {
  return PROJECTS[getProjectName(project)]
}

function getServiceOrThrow(project: ReturnType<typeof getProjectOrThrow>, service: string) {
  if (!(project.services as readonly string[]).includes(service)) {
    throw new Error(`Serviço desconhecido: ${service}`)
  }
  return service
}

export async function getLogs(projectName: string, serviceName: string, lines = 50) {
  const project = getProjectOrThrow(projectName)
  const service = getServiceOrThrow(project, serviceName)

  const { stdout } = await execAsync(
    `docker compose -f ${project.path}/${project.compose} logs --tail=${lines} ${service}`
  )

  return stdout.slice(-3000) // Limita o tamanho pra não quebrar o Telegram
}

export async function deployProject(projectName: string) {
  const project = getProjectOrThrow(projectName)

  const { stdout, stderr } = await execAsync(
    `cd ${project.path} && git pull && docker compose -f ${project.compose} up -d --build`,
    { timeout: 120000 } // 2 minutos de timeout
  )

  return { stdout: stdout.slice(-2000), stderr: stderr.slice(-1000) }
}

export async function restartService(projectName: string, serviceName: string) {
  const project = getProjectOrThrow(projectName)
  const service = getServiceOrThrow(project, serviceName)

  const { stdout } = await execAsync(
    `docker compose -f ${project.path}/${project.compose} restart ${service}`
  )

  return stdout
}

export async function getStatus(projectName?: string) {
  const projectNames = projectName ? [getProjectName(projectName)] : (Object.keys(PROJECTS) as ProjectName[])

  const results = await Promise.all(
    projectNames.map(async (name) => {
      const project = PROJECTS[name]
      const { stdout } = await execAsync(`docker compose -f ${project.path}/${project.compose} ps --format "table {{.Name}}\t{{.Status}}"`)
      return `📦 ${name}:\n${stdout.trim()}`
    })
  )

  return results.join('\n\n')
}
