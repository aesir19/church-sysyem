import 'dotenv/config'
import { validatePrismaEnv } from './env-utils.js'

const mode = process.argv[2] === 'migrate' ? 'migrate' : 'pull'
const { errors, warnings } = validatePrismaEnv(process.env, mode)

if (warnings.length) {
  for (const warning of warnings) {
    console.warn(`[prisma-env] warning: ${warning}`)
  }
}

if (errors.length) {
  for (const error of errors) {
    console.error(`[prisma-env] error: ${error}`)
  }
  process.exit(1)
}

console.log(`[prisma-env] ${mode} environment validation passed.`)
