import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url))

export const appVersion: string = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')).version
