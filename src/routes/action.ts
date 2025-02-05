import { Router } from 'express'
import { launch } from "../handlers/action/launch"
import { free } from "../handlers/action/free"
import { lease } from "../handlers/action/lease"

// The Routing Sheet
const ACTIONS_ROUTES = Router()

// The Routing Sheet
ACTIONS_ROUTES.post(
	'/launch',
	launch
)

ACTIONS_ROUTES.delete(
	'/free',
	free
)

ACTIONS_ROUTES.post(
	'/lease',
	lease
)

module.exports = ACTIONS_ROUTES