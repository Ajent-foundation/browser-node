import { Router } from 'express'
import { launch } from "../handlers/action/launch"
import { free } from "../handlers/action/free"
import { lease } from "../handlers/action/lease"
import { getRecordedData } from "../handlers/action/getRecordedData"
import { status } from "../handlers/recording/status"

const ACTIONS_ROUTES = Router()

ACTIONS_ROUTES.post('/launch', launch)
ACTIONS_ROUTES.delete('/free', free)
ACTIONS_ROUTES.post('/lease', lease)
ACTIONS_ROUTES.get('/recorded-data', getRecordedData)
ACTIONS_ROUTES.get('/status', status)

module.exports = ACTIONS_ROUTES