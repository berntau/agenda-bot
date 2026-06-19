import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export async function getResourceUsage() {
  const [disk, mem, load, containers] = await Promise.all([
    execAsync('df -h / --output=size,used,avail,pcent').then((r) => r.stdout.trim()),
    execAsync('free -h').then((r) => r.stdout.trim()),
    execAsync('uptime').then((r) => r.stdout.trim()),
    execAsync('docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"').then((r) => r.stdout.trim()),
  ])

  return `💽 Disco (/):\n${disk}\n\n🧠 Memória:\n${mem}\n\n⚙️ Carga:\n${load}\n\n📦 Containers:\n${containers}`
}

export async function getSecurityOverview() {
  const [ports, dockerPorts, firewall, fail2ban] = await Promise.all([
    execAsync('ss -tuln').then((r) => r.stdout.trim()),
    execAsync('docker ps --format "{{.Names}}: {{.Ports}}"').then((r) => r.stdout.trim()),
    execAsync('sudo -n ufw status').then((r) => r.stdout.trim()),
    execAsync('sudo -n fail2ban-client status sshd').then((r) => r.stdout.trim()),
  ])

  const publicPorts = ports
    .split('\n')
    .filter((line) => line.includes('0.0.0.0:') || line.includes('*:'))
    .join('\n')

  return `🌐 Portas escutando publicamente:\n${publicPorts}\n\n📦 Portas expostas por container:\n${dockerPorts}\n\n🛡️ Firewall:\n${firewall}\n\n🚫 Fail2ban (SSH):\n${fail2ban}`
}
