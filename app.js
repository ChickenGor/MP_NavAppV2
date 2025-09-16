let mapData = {};
let currentLocation = null;
let destination = null;
let lastScanned = null; // track last scanned QR

const qrPhysicalSizeCm = 10;
const focalLengthPx = 800;

const scanSound = document.getElementById("scanSound");
const voiceBtn = document.getElementById("voiceBtn");
const voiceText = document.getElementById("voiceText");

let recognition;

// =================== MAP LOADING ===================
fetch("map-data.json")
  .then((res) => res.json())
  .then((data) => {
    mapData = data;
    speak("Map loaded");
    console.log("Map data loaded:", mapData);
  })
  .catch((err) => {
    console.error("Map load failed:", err);
    speak("Failed to load map");
  });

// =================== VOICE FEEDBACK ===================
function speak(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  speechSynthesis.speak(utter);
  console.log("🔊 Speak:", text);
}

// =================== LOCATION NORMALISER ===================
function normaliseLocation(str) {
  return str
    .toLowerCase()
    .replace(/i want to go to|take me to|bring me to|go to|nearest/g, "")
    .replace(/and|end|add/g, "n")
    .replace(/[^a-z0-9]/g, "");
}

// =================== GRAPH BUILDER ===================
function buildGraph(edges) {
  const graph = {};
  edges.forEach((e) => {
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
    let current = [...pq].reduce((a, b) =>
      distances[a] < distances[b] ? a : b
    );
    pq.delete(current);
    if (current === end) break;

    graph[current].forEach((neighbor) => {
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

// =================== DISTANCE ===================
function getShortestDistance(start, end) {
  const graph = buildGraph(mapData.edges);
  const path = dijkstra(graph, start, end);
  if (path.length < 2) return Infinity;
  let distance = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const fromPos = mapData.nodes[path[i]] || mapData.turnPoints[path[i]];
    const toPos = mapData.nodes[path[i + 1]] || mapData.turnPoints[path[i + 1]];
    distance += Math.hypot(fromPos.x - toPos.x, fromPos.y - toPos.y);
  }
  return distance;
}

// =================== NAVIGATION ===================
function findShortestPath(start, end) {
  const graph = buildGraph(mapData.edges);
  const path = dijkstra(graph, start, end);
  if (path.length === 0) return speak("No path found");

  console.log("📍 Path:", path);

  const steps = [];

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    const fromPos = mapData.nodes[from] || mapData.turnPoints[from];
    const toPos = mapData.nodes[to] || mapData.turnPoints[to];

    let direction = "Go";
    if (i < path.length - 2) {
      const next = path[i + 2];
      const nextPos = mapData.nodes[next] || mapData.turnPoints[next];
      const angle =
        Math.atan2(nextPos.y - toPos.y, nextPos.x - toPos.x) -
        Math.atan2(toPos.y - fromPos.y, toPos.x - fromPos.x);
      const deg = (angle * 180) / Math.PI;
      if (deg > 45) direction = "Turn left";
      else if (deg < -45) direction = "Turn right";
      else direction = "Go straight";
    }

    const isImportant =
      to.startsWith("Staircase") ||
      to.startsWith("Gateway") ||
      to.startsWith("Toilet") ||
      to === end;

    if (isImportant || direction !== "Go") steps.push({ node: to, direction });
  }

  let i = 0;
  const stepInterval = setInterval(() => {
    if (i >= steps.length) {
      speak(`You have arrived at ${end}`);
      clearInterval(stepInterval);
      return;
    }
    speak(`${steps[i].direction} to ${steps[i].node}`);
    i++;
  }, 4000);
}

// =================== VOICE RECOGNITION ===================
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = "en-US";
  recognition.interimResults = false;

  let recognizing = false;

  recognition.onstart = () => {
    recognizing = true;
    voiceBtn.classList.add("listening");
    voiceText.innerText = "Listening...";
  };

  recognition.onend = () => {
    recognizing = false;
    voiceBtn.classList.remove("listening");
  };

  recognition.onerror = (e) => {
    console.error("❌ Voice recognition error:", e);
    voiceText.innerText = "Error recognizing speech";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    voiceText.innerText = transcript;
    speak(`You said: ${transcript}`);
    console.log("🎙 Voice recognized:", transcript);

    const allLocations = { ...mapData.nodes, ...mapData.turnPoints };
    const normalisedKeys = Object.keys(allLocations).reduce((acc, key) => {
      acc[normaliseLocation(key)] = key;
      return acc;
    }, {});

    const matchedKey = resolveSynonym(
      normaliseLocation(transcript),
      normalisedKeys,
      currentLocation
    );

    if (matchedKey) {
      destination = matchedKey;
      speak(`Navigating to ${matchedKey}`);
      if (currentLocation) findShortestPath(currentLocation, destination);
    } else {
      speak(`${transcript} is not recognized.`);
    }
  };

  voiceBtn?.addEventListener("click", () => {
    if (recognizing) return recognition.stop();
    try {
      recognition.start();
    } catch (err) {
      console.error("❌ Failed to start recognition:", err);
      voiceText.innerText = "Microphone error!";
      speak("Please allow microphone access and reload the page");
    }
  });
}

// =================== SYNONYMS ===================
const synonyms = {
  MainGateway: ["main gateway", "main entrance", "main exit"],
  Staircase1: ["staircase 1", "stairs 1", "near olive cafe stairs"],
  Staircase2: ["staircase 2", "stairs 2", "middle stairs"],
  Staircase3: ["staircase 3", "stairs 3", "far stairs"],
  Staircase4: ["staircase 4", "stairs 4", "near gateway a stairs"],
  MaleToilet1: ["male toilet 1", "mens toilet 1", "men's toilet 1"],
  MaleToilet2: ["male toilet 2", "mens toilet 2", "men's toilet 2"],
  FemaleToilet1: ["female toilet 1", "ladies toilet 1", "women toilet 1"],
  FemaleToilet2: ["female toilet 2", "ladies toilet 2", "women toilet 2"],
  OliveCafe: ["olive cafe", "olive cafeteria", "olive"],
  PanasExpress: ["panas express", "panas", "express cafe"],
  GatewayA: ["gateway a", "entrance a", "exit a"],
  GatewayA1: ["gateway a1", "entrance a1", "exit a1"],
  GatewayB: ["gateway b", "entrance b", "exit b"],
  GatewayB1: ["gateway b1", "entrance b1", "exit b1"],
  GatewayB2: ["gateway b2", "entrance b2", "exit b2"],
  GatewayC: ["gateway c", "entrance c", "exit c"],
};

function resolveSynonym(inputKey, normalisedKeys, currentNode) {
  if (normalisedKeys[inputKey]) return normalisedKeys[inputKey];

  for (let canonical in synonyms) {
    const normalizedSyns = synonyms[canonical].map(normaliseLocation);
    if (normalizedSyns.some((alt) => inputKey.includes(alt))) {
      if (["MaleToilet1", "MaleToilet2"].includes(canonical))
        return findNearestNode("maletoilet", currentNode);
      if (["FemaleToilet1", "FemaleToilet2"].includes(canonical))
        return findNearestNode("femaletoilet", currentNode);
      if (
        ["Staircase1", "Staircase2", "Staircase3", "Staircase4"].includes(
          canonical
        )
      )
        return findNearestNode("staircase", currentNode);
      return normalisedKeys[canonical] || canonical;
    }
  }
  return null;
}

function findNearestNode(category, currentNode) {
  let candidates = [];
  if (category === "maletoilet") candidates = ["MaleToilet1", "MaleToilet2"];
  else if (category === "femaletoilet")
    candidates = ["FemaleToilet1", "FemaleToilet2"];
  else if (category === "staircase")
    candidates = ["Staircase1", "Staircase2", "Staircase3", "Staircase4"];

  if (!currentNode || candidates.length === 0) return null;

  let nearest = null;
  let minDistance = Infinity;
  for (let node of candidates) {
    const distance = getShortestDistance(currentLocation, node);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = node;
    }
  }
  return nearest;
}

// =================== SOUND ===================
function playScanSound() {
  scanSound.currentTime = 0;
  scanSound.play();
}

// =================== QR SCANNER ===================
window.addEventListener("load", () => {
  cv.onRuntimeInitialized = () => {
    const qrDecoder = new cv.QRCodeDetector();
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    document.getElementById("reader").appendChild(video);

    const overlay = document.getElementById("overlay");
    const ctx = overlay.getContext("2d");

    const hiddenCanvas = document.createElement("canvas");
    const hiddenCtx = hiddenCanvas.getContext("2d");

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      .then((stream) => {
        video.srcObject = stream;
        video.addEventListener("playing", () => {
          hiddenCanvas.width = video.videoWidth;
          hiddenCanvas.height = video.videoHeight;
          overlay.width = video.videoWidth;
          overlay.height = video.videoHeight;
          processFrame();
        });
      });

    function processFrame() {
      if (!video || video.readyState !== 4) {
        requestAnimationFrame(processFrame);
        return;
      }

      hiddenCtx.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
      let src = cv.imread(hiddenCanvas);
      let gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      let points = new cv.Mat();
      let straightQr = new cv.Mat();
      let decodedText = qrDecoder.detectAndDecode(gray, points, straightQr);

      ctx.clearRect(0, 0, overlay.width, overlay.height);

      if (decodedText) {
        // Only trigger if different from lastScanned
        if (decodedText !== lastScanned) {
          lastScanned = decodedText;
          currentLocation = decodedText; // update current location immediately
          playScanSound();

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

          document.getElementById(
            "distanceInfo"
          ).innerText = `QR: ${decodedText}`;
          speak(`You are at ${decodedText}`);

          // Reset lastScanned after 3 seconds to allow re-scan
          setTimeout(() => {
            lastScanned = null;
          }, 3000);
        }
      }

      src.delete();
      gray.delete();
      points.delete();
      straightQr.delete();

      requestAnimationFrame(processFrame);
    }
  };
});
