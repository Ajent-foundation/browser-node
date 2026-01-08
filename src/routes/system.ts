import { Router } from 'express'
import { isBrowserActive } from "../handlers/system/isBrowserActive"
import { closeDialog } from "../handlers/system/closeDialog"
import { selectFileFromDialog } from "../handlers/system/selectFileFromDialog"
import { devtoolsVersion } from "../handlers/system/devtoolsVersion"
import { screenshot } from "../handlers/system/screenshot"
import { mouse } from "../handlers/system/mouse"
import { keyboard } from "../handlers/system/keyboard"
import { scroll } from "../handlers/system/scroll"
import { mouseLocation } from "../handlers/system/mouseLocation"
import { clipboardGet } from "../handlers/system/clipboardGet"
import { clipboardSet } from "../handlers/system/clipboardSet"
import { shellCommand } from "../handlers/system/shellCommand"
import { screenSize } from "../handlers/system/screenSize"
import { drag } from "../handlers/system/drag"
import { keyboardState } from "../handlers/system/keyboardState"
import { mouseState } from "../handlers/system/mouseState"
import { windows } from "../handlers/system/windows"
import { windowControl } from "../handlers/system/windowControl"

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

// Support both GET and POST for screenshot (some callers use GET, some use POST)
SYSTEM_ROUTES.get(
	'/screenshot',
	screenshot
)

SYSTEM_ROUTES.post(
	'/screenshot',
	screenshot
)

SYSTEM_ROUTES.post(
	'/mouse',
	mouse
)

SYSTEM_ROUTES.get(
	'/mouse/location',
	mouseLocation
)

SYSTEM_ROUTES.post(
	'/keyboard',
	keyboard
)

SYSTEM_ROUTES.post(
	'/scroll',
	scroll
)

SYSTEM_ROUTES.get(
	'/clipboard',
	clipboardGet
)

SYSTEM_ROUTES.post(
	'/clipboard',
	clipboardSet
)

SYSTEM_ROUTES.post(
	'/shell',
	shellCommand
)

SYSTEM_ROUTES.get(
	'/screen/size',
	screenSize
)

SYSTEM_ROUTES.post(
	'/drag',
	drag
)

SYSTEM_ROUTES.get(
	'/keyboard/state',
	keyboardState
)

SYSTEM_ROUTES.get(
	'/mouse/state',
	mouseState
)

SYSTEM_ROUTES.get(
	'/windows',
	windows
)

SYSTEM_ROUTES.post(
	'/window/control',
	windowControl
)

SYSTEM_ROUTES.get(
    '/devtools/version', 
    devtoolsVersion
)

module.exports = SYSTEM_ROUTES