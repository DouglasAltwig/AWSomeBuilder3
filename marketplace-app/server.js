const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cors = require('cors');
const errorhandler = require('errorhandler');

const itemRoutes = require('./routes/item.routes');
const db = require("./models");

var isProduction = process.env.NODE_ENV === 'production';

// Create global app object
var app = express();
app.set('view engine', 'ejs');

// var corsOptions = {origin: "http://localhost:8081"};
// app.use(cors(corsOptions));

// Normal express config defaults
app.use(require('morgan')('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(require('method-override')());
app.use(session({ secret: 'conduit', cookie: { maxAge: 60000 }, resave: false, saveUninitialized: false  }));
app.use(express.static(path.join(__dirname,'views')));

app.use('/api/items', itemRoutes);

app.get('/', (req,res) => {
  res.render('index', {
    data: {
      options: [
        {value: "approved", label: "Approved"},
        {value: "rejected", label: "Rejected"},
        {value: "in review", label: "In review"},
        {value: "escalated", label: "Escalated"},
      ]
    }
  });
});

// db.sequelize.sync();
// drop the table if it already exists
// db.sequelize.sync({ force: true }).then(() => {
//   console.log("Drop and re-sync db.");
// });

if (!isProduction) {
  app.use(errorhandler());
}

/// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

/// error handlers

// development error handler
// will print stacktrace
if (!isProduction) {
  app.use(function(err, req, res, next) {
    console.log(err.stack);

    res.status(err.status || 500);

    res.json({'errors': {
      message: err.message,
      error: err
    }});
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.json({'errors': {
    message: err.message,
    error: {}
  }});
});

// finally, let's start our server...
var server = app.listen( process.env.PORT || 8080, function(){
  console.log('Listening on port ' + server.address().port);
});
