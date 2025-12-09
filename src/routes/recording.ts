import { Router } from 'express'
import { status } from "../handlers/recording/status"
import { summary } from "../handlers/recording/summary"
import { exportData } from "../handlers/recording/export"
import { actions } from "../handlers/recording/actions"
import { network } from "../handlers/recording/network"
import { cdp } from "../handlers/recording/cdp"
import { rawData } from "../handlers/recording/rawData"
import { clearSession } from "../handlers/recording/clearSession"
import { clearAll } from "../handlers/recording/clearAll"

const RECORDING_ROUTES = Router()

RECORDING_ROUTES.get('/status', status)
RECORDING_ROUTES.get('/summary', summary)
RECORDING_ROUTES.get('/export', exportData)
RECORDING_ROUTES.get('/actions', actions)
RECORDING_ROUTES.get('/network', network)
RECORDING_ROUTES.get('/cdp', cdp)
RECORDING_ROUTES.get('/raw/:type', rawData)
RECORDING_ROUTES.delete('/data/:sessionId', clearSession)
RECORDING_ROUTES.delete('/data', clearAll)

module.exports = RECORDING_ROUTES

