import { prisma } from '../config/prisma.js'
import { encryptText } from '../utils/crypto.js'

const scopes = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

function isConfigured(value: string | undefined, placeholders: string[]) {
  if (!value?.trim()) return false
  return !placeholders.includes(value.trim())
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:4000/connected-accounts/google/callback'

  const hasClientId = isConfigured(clientId, ['your-google-client-id', 'your-client-id'])
  const hasClientSecret = isConfigured(clientSecret, ['your-google-client-secret', 'your-client-secret'])

  if (!hasClientId || !hasClientSecret) {
    console.warn('Skipping Google Drive config seed: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not configured.')
    return
  }

  const activeConfigs = await prisma.providerConfig.findMany({
    where: { userId: null, provider: 'google_drive', status: 'active' },
    orderBy: { createdAt: 'desc' },
  })

  const encrypted = {
    clientIdEncrypted: encryptText(clientId!),
    clientSecretEncrypted: encryptText(clientSecret!),
    redirectUri,
    scopes,
    status: 'active',
  }

  const config = activeConfigs[0]
    ? await prisma.providerConfig.update({ where: { id: activeConfigs[0].id }, data: encrypted })
    : await prisma.providerConfig.create({
        data: {
          userId: null,
          provider: 'google_drive',
          ...encrypted,
        },
      })

  if (activeConfigs.length > 1) {
    await prisma.providerConfig.updateMany({
      where: {
        userId: null,
        provider: 'google_drive',
        status: 'active',
        id: { not: config.id },
      },
      data: { status: 'disabled' },
    })
  }

  console.log(`Google Drive config ready: ${config.id}`)
}

const seedWatchdog = setTimeout(() => {
  console.warn('Google Drive config seed exceeded 30 seconds; continuing startup with the existing persisted provider configuration.')
  process.exit(0)
}, 30_000)

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    clearTimeout(seedWatchdog)
    await prisma.$disconnect()
  })
