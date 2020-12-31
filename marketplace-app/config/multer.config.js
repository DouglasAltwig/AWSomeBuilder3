require('dotenv').config()
const aws = require('aws-sdk')
const multer = require('multer')
const multerS3 = require('multer-s3')


aws.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
})

const s3 = new aws.S3()

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype === 'image/jpeg' || 
    file.mimetype === 'image/png' || 
    file.mimetype === 'video/mp4') {
    cb(null, true)
  } else {
    cb(new Error('Invalid file type, only JPEG, PNG and MP4 are allowed'), false)
  }
}

const upload = multer({
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 5 // 5 MB files
  },
  storage: multerS3({
    s3: s3,
    bucket: 'octank-marketplace',
    // contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      let mdata = {
        fieldName: file.fieldname, 
        originalname: file.originalname, 
        mimetype: file.mimetype
      }
      cb(null, mdata);
    },
    key: function (req, file, cb) {
      cb(null, `${Date.now().toString()}-${file.originalname}`)
    }
  })
})

module.exports = upload