import { Router } from 'express'
import { set } from "../handlers/session/set"
import { data } from "../handlers/session/data"
import { downloadSession } from "../handlers/session/download"
import { uploadSession } from "../handlers/session/upload"

// The Routing Sheet
const SESSION_ROUTES = Router()

// The Routing Sheet
SESSION_ROUTES.post(
	'/download',
	downloadSession
)

SESSION_ROUTES.post(
	'/upload',
	uploadSession
)

SESSION_ROUTES.get(
	'/data',
	data
)

SESSION_ROUTES.post(
	'/set',
	set
)

module.exports = SESSION_ROUTES