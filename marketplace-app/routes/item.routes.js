const items = require("../controllers/item.controller.js");
var router = require("express").Router();
const upload = require("../config/multer.config");
const singleUpload = upload.single('uploaded_file');

// Create a new Item
router.post("/", singleUpload, items.create);

// Retrieve all Items
router.get("/", items.findAll);

// Retrieve all Items in review
router.get("/inreview", items.findAllInReview);

// Retrieve all published Items
router.get("/published", items.findAllPublished);

// Retrieve a single Item with id
router.get("/:id", items.findOne);

// Update a Item with id
router.put("/:id", items.update);

// Delete a Item with id
router.delete("/:id", items.delete);

// Delete all Items
router.delete("/", items.deleteAll);

module.exports = router;

