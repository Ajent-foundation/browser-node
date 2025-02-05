import { Router } from 'express'
import { download } from "../handlers/files/download"
import { upload, preUpload } from "../handlers/files/upload"
import { list } from "../handlers/files/list"
import multer, { Multer } from 'multer';

// Configure multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, '/home/user/uploads/');
    },
    filename: function (req, file, cb) {
        cb(null,  `${Date.now()}-${file.originalname}`);
    }
});

// Initialize multer with the storage options
const multerUploader: Multer = multer({ 
	storage ,
	limits: {
		fileSize: 10 * 1024 * 1024, // 10 MB
        fieldNameSize: 32 
	}
});

// The Routing Sheet
const FILES_ROUTES = Router()

// The Routing Sheet
FILES_ROUTES.get(
	'/list',
	list
)

FILES_ROUTES.post(
	'/download/:fileName',
	download
)

FILES_ROUTES.post(
	'/upload',
	preUpload,
	multerUploader.single('file'),
	upload
)

module.exports = FILES_ROUTES