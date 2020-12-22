const db = require("../models");
const Item = db.items;
const Op = db.Sequelize.Op;
const AWS = require('aws-sdk');

AWS.config.update({region: 'us-east-1'})

const s3 = new AWS.S3({apiVersion: '2006-03-01'})
const Status = ["approved", "rejected", "in review", "escalated"]

// Create and Save a new Item
exports.create = (req, res) => {
  // Validate request
  if (!req.body.title) {
    res.status(400).send({message: "Content can not be empty!"});
    return;
  }
  
  if (!req.body.description) {
    res.status(400).send({message: "Content can not be empty!"});
    return;
  }

  if (!req.body.status) {
    res.status(400).send({message: "Content can not be empty!"});
    return;
  }

  if (!Status.includes(req.body.status)) {
    res.status(400).send({message: "Unknown status."})
    return;
  }
  
  if (!req.file) {
    res.status(409).send({message: "File Upload Error"});
    return;
  }

  // Create an Item
  const item = {
    title: req.body.title,
    description: req.body.description,
    file_path: req.file.location,
    status: req.body.status,
    published: req.body.published ? req.body.published : false
  };

  // Save Item in the database
  Item.create(item)
    .then(data => {
      res.send(data);
    })
    .catch(err => {
      res.status(500).send({
        message:
          err.message || "Some error occurred while creating the Item."
      });
    });
};

// Retrieve all Items from the database.
exports.findAll = (req, res) => {
  const title = req.query.title;
  var condition = title ? { title: { [Op.like]: `%${title}%` } } : null;

  Item.findAll({ where: condition })
    .then(data => {
      res.send(data);
    })
    .catch(err => {
      res.status(500).send({
        message:
          err.message || "Some error occurred while retrieving items."
      });
    });
};

// Find a single Item with an id
exports.findOne = (req, res) => {
  const id = req.params.id;

  Item.findByPk(id)
    .then(data => {
      res.send(data);
    })
    .catch(err => {
      res.status(500).send({
        message: "Error retrieving Item with id=" + id
      });
    });
};

// Update an Item by the id in the request
exports.update = (req, res) => {
  const id = req.params.id;

  Item.update(req.body, {
    where: { id: id }
  })
    .then(num => {
      if (num == 1) {
        res.send({
          message: "Item was updated successfully."
        });
      } else {
        res.send({
          message: `Cannot update Item with id=${id}. Maybe Item was not found or req.body is empty!`
        });
      }
    })
    .catch(err => {
      res.status(500).send({
        message: "Error updating Item with id=" + id
      });
    });
};

// Delete an Item with the specified id in the request
exports.delete = (req, res) => {
  const id = req.params.id;

  Item.destroy({
    where: { id: id }
  })
    .then(num => {
      if (num == 1) {
        res.send({
          message: "Item was deleted successfully!"
        });
      } else {
        res.send({
          message: `Cannot delete Item with id=${id}. Maybe Item was not found!`
        });
      }
    })
    .catch(err => {
      res.status(500).send({
        message: "Could not delete Item with id=" + id
      });
    });
};

// Delete all Items from the database.
exports.deleteAll = (req, res) => {
  Item.destroy({
    where: {},
    truncate: false
  })
    .then(nums => {
      res.send({ message: `${nums} Items were deleted successfully!` });
    })
    .catch(err => {
      res.status(500).send({
        message:
          err.message || "Some error occurred while removing all items."
      });
    });
};

// Download file for a given bucket and key
exports.download = (req, res) => {
  // Get parameter from the request object
  if (!req.params.bucket) {
    res.status(400).send({message: "Bucket can not be empty!"});
    return;
  }
  if (!req.params.key) {
    res.status(400).send({message: "File can not be empty!"});
    return;
  }
  const params = {'Bucket': req.params.bucket, 'Key': req.params.key}
  s3.getObject(params)
  .promise()
  .then(data => {
    res.writeHead(200, {
      'Content-Type': data.Metadata.mimetype,
      'Content-Disposition': 'inline;filename=' + data.Metadata.originalname,
      'Content-Length': data.ContentLength,
      'x-timestamp': Date.now(),
      'x-sent': true,
      'ETag': data.ETag.slice(1,-1),
      'Cache-Control': 0,
      'Accept-Ranges': 'bytes'
    });
    let encodedImage = Buffer.from(data.Body, 'binary')
    res.end(encodedImage);
  })
  .catch(err => {
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving the file."
    })
  })
}
exports.findAllInReview = (req, res) => {
  Item.findAll({where: {status: "in review"}})
    .then(data => {
      res.send(data);
    })
    .catch(err => {
      res.status(500).send({
        message:
          err.message || "Some error occurred while retrieving items."
      })
    })
}
// find all published Item
exports.findAllPublished = (req, res) => {
  Item.findAll({ where: { published: true } })
    .then(data => {
      res.send(data);
    })
    .catch(err => {
      res.status(500).send({
        message:
          err.message || "Some error occurred while retrieving items."
      });
    });
};
