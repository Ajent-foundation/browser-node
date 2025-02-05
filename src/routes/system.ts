import { Router } from 'express'
import { isBrowserActive } from "../handlers/system/isBrowserActive"
import { closeDialog } from "../handlers/system/closeDialog"
import { selectFileFromDialog } from "../handlers/system/selectFileFromDialog"
import { screenshot } from "../handlers/system/screenshot"
import { mouse } from "../handlers/system/mouse"
import { keyboard } from "../handlers/system/keyboard"

// The Routing Sheet
const SYSTEM_ROUTES = Router()

SYSTEM_ROUTES.get(
	'/isBrowserActive',
	isBrowserActive
)

SYSTEM_ROUTES.post(
	'/closeDialog',
	closeDialog
)

SYSTEM_ROUTES.post(
	'/selectFileFromDialog',
	selectFileFromDialog
)

SYSTEM_ROUTES.post(
	'/screenshot',
	screenshot
)


SYSTEM_ROUTES.post(
	'/mouse',
	mouse
)

SYSTEM_ROUTES.post(
	'/keyboard',
	keyboard
)

module.exports = SYSTEM_ROUTES