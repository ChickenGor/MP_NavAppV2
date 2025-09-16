let mapData = {};
let currentLocation = null;
let destination = null;

const qrPhysicalSizeCm = 10;
const focalLengthPx = 800;

const scanSound = document.getElementById('scanSound');
const voiceBtn = document.getElementById('voiceBtn');
const voiceText = document.getElementById('voiceText');

let recognition;
let lastScanned = null;

// =================== MAP LOADING ===================
fetch('map-data.json')
  .then(res => res.json())
  .then(data => {
    mapData = data;
    speak("Map loaded");
    console.log("Map data loaded:", mapData);
  })
  .catch(err => {
    console.error("Map load failed:", err);
    speak("Failed to load map");
  });

// =================== VOICE FEEDBACK ===================
function speak(text) {
  console.log("Speak:", text);
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  speechSynthesis.speak(utter);
}

// =================== QR DISTANCE ESTIMATION ===================
function estimateDistance(pixelWidth) {
  return (qrPhysicalSizeCm * focalLengthPx) / pixelWidth;
}

// =================== LOCATION NORMALISER ===================
function normaliseLocation(str) {
  return str
    .toLowerCase()
    .replace(/and|end|add/g, 'n') // common mishearing of “N”
    .replace(/[^a-z0-9]/g, '');   // strip spaces and punctuation
}

// =================== GRAPH BUILDER ===================
function buildGraph(edges) {
  const graph = {};
  edges.forEach(e => {
    if (!graph[e.from]) graph[e.from] = [];
    if (!graph[e.to]) graph[e.to] = [];
    const fromPos = mapData.nodes[e.from] || mapData.turnPoints[e.from];
    const toPos = mapData.nodes[e.to] || mapData.turnPoints[e.to];
    const distance = Math.hypot(fromPos.x - toPos.x, fromPos.y - toPos.y);
    graph[e.from].push({ node: e.to, weight: distance });
    graph[e.to].push({ node: e.from, weight: distance });
  });
  return graph;
}

// =================== DIJKSTRA ===================
function dijkstra(graph, start, end) {
  const distances = {};
  const prev = {};
  const pq = new Set(Object.keys(graph));
  for (let node in graph) distances[node] = Infinity;
  distances[start] = 0;

  while (pq.size > 0) {
    let current = [...pq].reduce((a, b) => distances[a] < distances[b] ? a : b);
    pq.delete(current);
    if (current === end) break;

    graph[current].forEach(neighbor => {
      let alt = distances[current] + neighbor.weight;
      if (alt < distances[neighbor.node]) {
        distances[neighbor.node] = alt;
        prev[neighbor.node] = current;
      }
    });
  }

  const path = [];
  let u = end;
  while (u) {
    path.unshift(u);
    u = prev[u];
  }
  return path;
}

function findShortestPath(start, end) {
  const graph = buildGraph(mapData.edges);
  const path = dijkstra(graph, start, end);
  if (path.length === 0) return speak("No path found");

  speak(`Shortest path: ${path.join(' → ')}`);
  console.log("Path:", path);

  let i = 0;
  const stepInterval = setInterval(() => {
    if (i >= path.length) {
      speak("You have arrived at your destination");
      clearInterval(stepInterval);
      return;
    }
    speak(`Next: ${path[i]}`);
    i++;
  }, 4000);
}

// =================== DESTINATION SET BUTTON ===================
document.getElementById('setDestination').addEventListener('click', () => {
  const dest = prompt("Enter destination node ID (e.g., N010, OliveCafe):");
  if (!dest) return;

  const allLocations = { ...mapData.nodes, ...mapData.turnPoints };
  const normalisedKeys = Object.keys(allLocations).reduce((acc, key) => {
    acc[normaliseLocation(key)] = key;
    return acc;
  }, {});
  const matchedKey = normalisedKeys[normaliseLocation(dest)];

  if (matchedKey) {
    destination = matchedKey;
    speak(`Destination set to ${destination}`);
    if (currentLocation) findShortestPath(currentLocation, destination);
    else speak("Scan current location first");
  } else {
    speak("Invalid destination");
  }
});

// =================== VOICE RECOGNITION ===================
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = 'en-US';
  recognition.interimResults = false;

  recognition.onresult = function (event) {
    const transcript = event.results[0][0].transcript.trim();
    voiceText.innerText = transcript;
    speak(`You said: ${transcript}`);
    console.log("Voice recognized:", transcript);

    const allLocations = { ...mapData.nodes, ...mapData.turnPoints };
    const normalisedKeys = Object.keys(allLocations).reduce((acc, key) => {
      acc[normaliseLocation(key)] = key;
      return acc;
    }, {});
    const matchedKey = normalisedKeys[normaliseLocation(transcript)];

    if (matchedKey) {
      destination = matchedKey;
      speak(`Navigating to ${matchedKey}`);
      if (currentLocation) findShortestPath(currentLocation, destination);
    } else {
      speak(`${transcript} is not recognized.`);
    }
  };

  recognition.onend = () => {
    voiceBtn.classList.remove('listening');
  };
  recognition.onerror = (e) => {
    console.error("Voice recognition error:", e);
    voiceBtn.classList.remove('listening');
    voiceText.innerText = "Error recognizing speech";
  };

  voiceBtn.addEventListener('click', () => {
    voiceBtn.classList.add('listening');
    recognition.start();
  });
} else {
  voiceText.innerText = "Speech recognition not supported";
}

// =================== SOUND ===================
function playScanSound() {
  scanSound.currentTime = 0;
  scanSound.play();
}

// =================== QR SCANNER (OpenCV.js) ===================

window.addEventListener('load', () => {
  console.log("Initializing QR Scanner...");

  cv['onRuntimeInitialized'] = () => {
    console.log("OpenCV ready, starting camera...");
    const qrDecoder = new cv.QRCodeDetector();

    const video = document.createElement("video");
    video.setAttribute("autoplay", true);
    video.setAttribute("playsinline", true); // iOS fix
    document.getElementById("reader").appendChild(video);

    const overlay = document.getElementById("overlay");
    const ctx = overlay.getContext("2d");

    // Hidden canvas to grab frames
    const hiddenCanvas = document.createElement("canvas");
    const hiddenCtx = hiddenCanvas.getContext("2d");

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then(stream => {
        video.srcObject = stream;
        video.addEventListener("playing", () => {
          console.log("Camera stream ready.");
          overlay.width = video.videoWidth;
          overlay.height = video.videoHeight;
          hiddenCanvas.width = video.videoWidth;
          hiddenCanvas.height = video.videoHeight;
          processFrame();
        });
      })
      .catch(err => console.error("Camera error:", err));

    function processFrame() {
      if (!video || video.readyState !== 4) {
        requestAnimationFrame(processFrame);
        return;
      }

      ctx.clearRect(0, 0, overlay.width, overlay.height);

      // Capture frame from hidden canvas
      hiddenCtx.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
      let src = cv.imread(hiddenCanvas);

      // Convert to gray (simpler preprocessing)
      let gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Detect QR
      let points = new cv.Mat();
      let straightQr = new cv.Mat();
      let decodedText = qrDecoder.detectAndDecode(gray, points, straightQr);

      if (decodedText && decodedText !== lastScanned) {
        lastScanned = decodedText;
        console.log("QR detected:", decodedText);

        playScanSound();

        // Draw tracking box
        if (points.rows > 0) {
          ctx.beginPath();
          ctx.strokeStyle = "lime";
          ctx.lineWidth = 4;
          ctx.moveTo(points.data32F[0], points.data32F[1]);
          for (let i = 2; i < points.data32F.length; i += 2) {
            ctx.lineTo(points.data32F[i], points.data32F[i + 1]);
          }
          ctx.closePath();
          ctx.stroke();
        }

        // Update UI
        if (mapData.nodes[decodedText] || mapData.turnPoints[decodedText]) {
          currentLocation = decodedText;
          document.getElementById('distanceInfo').innerText = `QR: ${decodedText}`;
          speak(`You are at ${decodedText}`);
        } else {
          document.getElementById('distanceInfo').innerText = `Unknown location`;
          speak(`Unknown QR`);
        }

        // Ask for destination
        speak(`You are at ${decodedText}. Where do you want to go?`);
        if (recognition) recognition.start();

        // Prevent duplicates for 3 sec
        setTimeout(() => lastScanned = null, 3000);
      }

      // cleanup
      src.delete(); gray.delete(); points.delete(); straightQr.delete();

      requestAnimationFrame(processFrame);
    }
  };
});



