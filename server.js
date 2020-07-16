var express = require('express'),
  app = express(),
  server = require('http').createServer(app)

app.use(express.static(__dirname + '/public'));
app.use(app.router);

app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

app.get('/phone', function (req, res) {
  res.sendfile(__dirname + '/phone.html');
});

server.listen(8080);

require("dronestream").listen(server);

var io = require('socket.io').listen(server);

io.set('destroy upgrade', false);

io.sockets.on('connection', function (socket) {
  console.log('connection');

  socket.on('takeoff', function (data) {
    console.log('takeoff', data)
    mission.client().takeoff()
  });

  socket.on('land', function (data) {
    console.log('land', data)
    mission.client().land()
  });

  socket.on('reset', function (data) {
    console.log('reset', data)
    mission.client().disableEmergency()
  });

  socket.on('phone', function (data) {
    console.log('phone', data)
    targetLat = data.lat
    targetLon = data.lon
    phoneAccuracy = data.accuracy
  });

  socket.on('go', function (data) {
    targetLat = data.lat
    targetLon = data.lon
    console.log('go', data);
    //Go to waypoint
    run();
  });

  socket.on('stop', function (data) {
    stop();
  });

  socket.on('twitter', function (data) {
    executeTwitterEvent();
  });

  socket.on('thesis', function (data) {
    executeThesis();
  });

  socket.on('manualControl', function (key) {
    executeEvent(key);
  });

  socket.on('missionParams', function (params) {
    shouldRotate = params.shouldRotate;
    shouldCalibrate = params.shouldCalibrate;
    altitude = Number(params.altitude);
  });

  setInterval(function () {
    io.sockets.emit('drone', { lat: currentLat, lon: currentLon, yaw: currentYaw, distance: currentDistance, battery: battery })
    io.sockets.emit('phone', { lat: targetLat, lon: targetLon, accuracy: phoneAccuracy })
  }, 1000)
});

var autonomy = require('ardrone-autonomy');
var geolib = require("geolib");
var mission = autonomy.createMission();

const Twitter = require("twitter");
const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config()

const twitter = new Twitter({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token_key: process.env.ACCESS_TOKEN_KEY,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET
})

//receive navdata configuration
mission.client().config('general:navdata_demo', 'FALSE');

var targetLat,
  targetLon,
  currentLat,
  currentLon,
  currentDistance,
  currentYaw,
  phoneAccuracy,
  yawAdjustment,
  distance,
  droneBearing,
  displacementVector,
  displacement,
  altitude = 0,
  shouldCalibrate = false,
  shouldRotate = true,
  battery;

var stop = function () {
  console.log('stop');
  targetYaw = null
  targetLat = null
  targetLon = null
  mission.client().stop()
};

let takePhoto = async function (data) {

  setTimeout(function () {
    mission.client().getPngStream().once('data', function (data) {
      var fileName = 'public/images/tcc.png';
      // Save the picture
      fs.writeFile(fileName, data, function (err) {
        if (err) {
          return console.log(err)
        } else {
          return console.log("Saved!")
        }
      });
    });
  }, 4000);
};

let postTwitter = function () {

  const imageData = fs.readFileSync('./public/images/tcc.png')
  setTimeout(function () {
    twitter.post("media/upload", { media: imageData }, function (error, media, response) {
      if (error) {
        console.log(error)
        return false
      } else {
        const status = {
          status: "Defesa do TCC, foto aérea capturada pelo AR.Drone 2.0 autonômo! FURB",
          media_ids: media.media_id_string
        }
        twitter.post("statuses/update", status, function (error, tweet, response) {
          return error ? false : true
        })
      }
    })
  }, 4000);
};

let executeTwitterEvent = function () {

  mission.altitude(1.5)
  mission.run()
  takeAndPost()

};

let flip = function () {
  mission.client()
    .after(3000, function () {
      this.animate('flipLeft', 1000);
      console.log("Flip")
    })
    .after(2000, function () {
      this.land();
    })
}

let takeAndPost = async function () {
  fs.watch('public/images/tcc.png', function (event, filename) {
    if (event == 'change') {
      console.log("File change: " + event)
      postTwitter();
      flip();
    }
  });
  await takePhoto().then(() => {
    console.log("Picture taken")
  });
};

let executeThesis = function () {
  mission.client().calibrate('0')

  //Do the autonomous fly
  mission.up(0.3)
    .forward(1)
    .cw(180)
    .up(0.3)
    .cw(90)
    .backward(0.5)
    .cw(90)
    .down(0.5)
    .hover(1000)
    .land()
  mission.run()

};

let executeEvent = function (key) {

  mission.client()
    .after(1, function () {
      if (key == "ArrowLeft")
        this.left(0.2);
      else if (key == "ArrowRight")
        this.right(0.2);
      else if (key == "ArrowUp")
        this.front(0.2)
      else if (key == "ArrowDown")
        this.back(0.2)
      else if (key == "s")
        this.down(0.2)
      else if (key == "w")
        this.up(0.2)
    })
    .after(1000, function () {
      this.stop();
    })
};

let run = function () {

  //var missonTestGO = true;

  // Drone calibrate 
  if (shouldCalibrate) {
    mission.client().calibrate('0'); //Calibrate passing 0 = magnometer
  }

  // Goes to destined altitude
  altitude = altitude > 0 ? altitude : 8;

  mission.altitude(altitude)
    .hover(1000)
  mission.run()

  if (displacement > 1) {

    displacement = displacement > 30 ? 28 : displacement; //Test wifi range

    //Test the go option
    /*if (shouldRotate && missonTestGO) {
      if (Math.abs(yawAdjustment) > 0.1) {
        mission.cw(yawAdjustment)
        mission.run()
      }
      // Go to waypoint
      mission.go({ x: displacement, y: 0, z: [targetLat, targetLon], yaw: 0 }).hover(100);
      mission.run()
    } else if (missonTestGO) {
      mission.go({ x: displacementVector.elements[0], y: displacementVector.elements[1], z: [targetLat, targetLon], yaw: 0 }).hover(100);
      mission.run()
    }*/

    // Craft mission
    console.log("Crafting mision")

    //Turn clockwise in the direction to face the waypoint
    mission.cw(yawAdjustment)
    mission.run()

    mission.zero()
      .up(2)
      .ccw(yawAdjustment)
      .hover(1000)
      .forward(displacement)

    mission.run(function (err, result) {
      if (err) {
        console.log("Oops, something bad happened: %s", err.message);
        stop();
      } else if (result) {
        io.sockets.emit('waypointReached', { lat: targetLat, lon: targetLon });
        console.log('Reached ', targetLat, targetLon);
        stop();
      }
    });
  } else {
    console.log("The distance is too short!");
    run()
  }
};

//Process all navdata from drone
let handleNavData = async function (data) {

  if (data.demo == null || data.gps == null) return;

  battery = data.demo.batteryPercentage;
  currentLat = data.gps.latitude;
  currentLon = data.gps.longitude;
  currentYaw = data.demo.rotation.yaw; // Live angle

  if (targetLat == null || targetLon == null || currentYaw == null || currentLat == null || currentLon == null) return;

  // Calculate distance to waypoint
  distance = await geolib.getPreciseDistance({ latitude: currentLat, longitude: currentLon },
    { latitude: targetLat, longitude: targetLon }, 1, 2);
  currentDistance = distance;

  // Get angle of drone
  droneBearing = await geolib.getGreatCircleBearing({ latitude: currentLat, longitude: currentLon },
    { latitude: targetLat, longitude: targetLon });

  // Find X and Y components of displacement vector
  displacementVector = $V([Math.cos(droneBearing) * distance, Math.sin(droneBearing) * distance]);

  // Calculate angle needed to rotate so that the drone is facing the waypoint
  yawAdjustment = droneBearing;

  // Convert yaw adjsutment to degrees and normalize
  yawAdjustment *= 180 / Math.PI;
  while (yawAdjustment > 180) { yawAdjustment -= 360; }
  while (yawAdjustment < -180) { yawAdjustment += 360; }

  // Normalize the angle
  yawAdjustment -= currentYaw;

  if (shouldRotate) {
    displacement = Math.hypot(displacementVector.elements[0], displacementVector.elements[1]);
  } else {
    displacement = distance;
  }
};

mission.client().on('navdata', handleNavData);