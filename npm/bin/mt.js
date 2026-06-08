#!/usr/bin/env node
import { runMtCli } from '../index.js'

process.exitCode = await runMtCli(process.argv.slice(2))
