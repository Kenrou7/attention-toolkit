import { FaceDetector, FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const video = document.querySelector("#cameraFeed");
const canvas = document.querySelector("#overlay");
const emptyState = document.querySelector("#emptyState");
const viewerNotice = document.querySelector("#viewerNotice");
const cameraHint = document.querySelector("#cameraHint");
const presenceBadge = document.querySelector("#presenceBadge");
const faceCount = document.querySelector("#faceCount");
const confidenceValue = document.querySelector("#confidenceValue");
const lastSeenValue = document.querySelector("#lastSeenValue");
const headOrientationValue = document.querySelector("#headOrientationValue");
const eyeTrackingValue = document.querySelector("#eyeTrackingValue");
const errorBanner = document.querySelector("#errorBanner");

const context = canvas.getContext("2d");

const ORIENTATION_THRESHOLDS = {
  yawNoticeable: 0.28,
  yawStrong: 0.55,
  tiltNoticeable: 14,
  tiltStrong: 24,
};

const GAZE_THRESHOLDS = {
  horizontalMin: 0.40,
  horizontalMax: 0.60,
  verticalMin: 0.42,
  verticalMax: 0.58,
  minEyeAspect: 0.12,
};

let detector;
let landmarker;
let cameraStream;
let animationFrameId;
let lastVideoTime = -1;
let lastSeenAt;

function setPresence(state, label) {
  presenceBadge.textContent = label;
  presenceBadge.classList.remove("presence-idle", "presence-ok", "presence-warn");
  presenceBadge.classList.add(state);
}

function setViewerNotice(state, label) {
  viewerNotice.textContent = label;
  viewerNotice.classList.remove("viewer-notice-idle", "viewer-notice-active", "viewer-notice-warn");
  viewerNotice.classList.add(state);
}

function setError(message) {
  if (!message) {
    errorBanner.hidden = true;
    errorBanner.textContent = "";
    cameraHint.textContent = "Video stays in the browser for this preview.";
    return;
  }

  errorBanner.hidden = false;
  errorBanner.textContent = message;
  cameraHint.textContent = message;
}

function updateLastSeen() {
  if (!lastSeenAt) {
    lastSeenValue.textContent = "Never";
    return;
  }

  lastSeenValue.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(lastSeenAt);
}

function updateHeadOrientation(label) {
  headOrientationValue.textContent = label;
}

function updateEyeTracking(label) {
  eyeTrackingValue.textContent = label;
}

function resizeCanvas() {
  const width = video.videoWidth || video.clientWidth;
  const height = video.videoHeight || video.clientHeight;

  if (!width || !height) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
}

function clearOverlay() {
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function getCameraOrderedPair(points) {
  return [...points].sort((firstPoint, secondPoint) => firstPoint.x - secondPoint.x);
}

function classifyDirection(strength, mildLabel, strongLabel, noticeableThreshold, strongThreshold) {
  const absoluteStrength = Math.abs(strength);

  if (absoluteStrength < noticeableThreshold) {
    return "";
  }

  return absoluteStrength >= strongThreshold ? strongLabel : mildLabel;
}

function joinOrientationLabels(labels) {
  return labels.filter(Boolean).join(" + ");
}

function getCenterRatio(value, start, end) {
  const minEdge = Math.min(start, end);
  const maxEdge = Math.max(start, end);
  const span = maxEdge - minEdge;

  if (span < 0.001) {
    return null;
  }

  return (value - minEdge) / span;
}

function getDistance(firstPoint, secondPoint) {
  return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}

function isInRange(value, minValue, maxValue) {
  return value >= minValue && value <= maxValue;
}

function isLookingAtScreen(faceLandmarks, orientationLabel) {
  if (!faceLandmarks || faceLandmarks.length < 474) {
    return "Unavailable";
  }

  const leftIris = faceLandmarks[468];
  const rightIris = faceLandmarks[473];

  const leftEyeOuter = faceLandmarks[33];
  const leftEyeInner = faceLandmarks[133];
  const rightEyeInner = faceLandmarks[362];
  const rightEyeOuter = faceLandmarks[263];

  const leftEyeTop = faceLandmarks[159];
  const leftEyeBottom = faceLandmarks[145];
  const rightEyeTop = faceLandmarks[386];
  const rightEyeBottom = faceLandmarks[374];
  const leftHorizontal = getCenterRatio(leftIris.x, leftEyeOuter.x, leftEyeInner.x);
  const rightHorizontal = getCenterRatio(rightIris.x, rightEyeInner.x, rightEyeOuter.x);
  const leftVertical = getCenterRatio(leftIris.y, leftEyeTop.y, leftEyeBottom.y);
  const rightVertical = getCenterRatio(rightIris.y, rightEyeTop.y, rightEyeBottom.y);

  if ([leftHorizontal, rightHorizontal, leftVertical, rightVertical].some((value) => value === null)) {
    return "Unavailable";
  }

  const leftEyeWidth = Math.max(getDistance(leftEyeOuter, leftEyeInner), 0.001);
  const rightEyeWidth = Math.max(getDistance(rightEyeInner, rightEyeOuter), 0.001);
  const leftEyeHeight = getDistance(leftEyeTop, leftEyeBottom);
  const rightEyeHeight = getDistance(rightEyeTop, rightEyeBottom);
  const leftEyeAspect = leftEyeHeight / leftEyeWidth;
  const rightEyeAspect = rightEyeHeight / rightEyeWidth;

  const hasClosedEyes =
    leftEyeAspect < GAZE_THRESHOLDS.minEyeAspect ||
    rightEyeAspect < GAZE_THRESHOLDS.minEyeAspect;

  const hasStrongTurn = orientationLabel.includes("Left turn") || orientationLabel.includes("Right turn");
  const leftEyeCentered =
    isInRange(leftHorizontal, GAZE_THRESHOLDS.horizontalMin, GAZE_THRESHOLDS.horizontalMax) &&
    isInRange(leftVertical, GAZE_THRESHOLDS.verticalMin, GAZE_THRESHOLDS.verticalMax);
  const rightEyeCentered =
    isInRange(rightHorizontal, GAZE_THRESHOLDS.horizontalMin, GAZE_THRESHOLDS.horizontalMax) &&
    isInRange(rightVertical, GAZE_THRESHOLDS.verticalMin, GAZE_THRESHOLDS.verticalMax);
  const isCenteredEyes = leftEyeCentered && rightEyeCentered;

  return isCenteredEyes && !hasStrongTurn && !hasClosedEyes
    ? "Looking at screen"
    : "Not looking at screen";
}

function getHeadOrientation(detection) {
  const keypoints = detection.keypoints || [];

  if (keypoints.length < 6) {
    return "Unavailable";
  }

  const [cameraLeftEye, cameraRightEye] = getCameraOrderedPair(keypoints.slice(0, 2));
  const noseTip = keypoints[2];
  const mouthCenter = keypoints[3];
  const [cameraLeftEar, cameraRightEar] = getCameraOrderedPair(keypoints.slice(4, 6));

  const eyeSpan = Math.max(cameraRightEye.x - cameraLeftEye.x, 0.001);
  const eyeCenterX = (cameraLeftEye.x + cameraRightEye.x) / 2;
  const eyeRollDegrees = Math.atan2(
    cameraRightEye.y - cameraLeftEye.y,
    cameraRightEye.x - cameraLeftEye.x
  ) * (180 / Math.PI);

  const noseOffset = (noseTip.x - eyeCenterX) / (eyeSpan / 2);
  const mouthOffset = (mouthCenter.x - eyeCenterX) / (eyeSpan / 2);
  const earCenterX = (cameraLeftEar.x + cameraRightEar.x) / 2;
  const earOffset = (noseTip.x - earCenterX) / Math.max(cameraRightEar.x - cameraLeftEar.x, 0.001);
  const yawSignal = (noseOffset * 0.6) + (mouthOffset * 0.25) + (earOffset * 0.15);

  const horizontalLabel = yawSignal > 0
    ? classifyDirection(
        yawSignal,
        "Slight right turn",
        "Right turn",
        ORIENTATION_THRESHOLDS.yawNoticeable,
        ORIENTATION_THRESHOLDS.yawStrong
      )
    : classifyDirection(
        yawSignal,
        "Slight left turn",
        "Left turn",
        ORIENTATION_THRESHOLDS.yawNoticeable,
        ORIENTATION_THRESHOLDS.yawStrong
      );

  const tiltLabel = eyeRollDegrees > 0
    ? classifyDirection(
        eyeRollDegrees,
        "Slight right tilt",
        "Right tilt",
        ORIENTATION_THRESHOLDS.tiltNoticeable,
        ORIENTATION_THRESHOLDS.tiltStrong
      )
    : classifyDirection(
        eyeRollDegrees,
        "Slight left tilt",
        "Left tilt",
        ORIENTATION_THRESHOLDS.tiltNoticeable,
        ORIENTATION_THRESHOLDS.tiltStrong
      );

  if (!horizontalLabel && !tiltLabel) {
    return "Centered";
  }

  return joinOrientationLabels([horizontalLabel, tiltLabel]);
}

function drawDetections(detections) {
  clearOverlay();

  context.save();
  context.scale(-1, 1);
  context.translate(-canvas.width, 0);
  context.lineWidth = 4;
  context.strokeStyle = "#46d5b7";
  context.fillStyle = "rgba(70, 213, 183, 0.18)";
  context.font = "600 16px Avenir Next";

  detections.forEach((detection) => {
    const { originX, originY, width, height } = detection.boundingBox;
    const score = Math.round((detection.categories?.[0]?.score || 0) * 100);

    context.beginPath();
    context.rect(originX, originY, width, height);
    context.fill();
    context.stroke();
    context.fillStyle = "#dffef6";
    context.fillText(`Face ${score}%`, originX + 8, Math.max(originY + 22, 22));
    context.fillStyle = "rgba(70, 213, 183, 0.18)";
  });

  context.restore();
}

async function ensureDetector() {
  if (detector) {
    return detector;
  }

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
  });

  return detector;
}

async function ensureLandmarker() {
  if (landmarker) {
    return landmarker;
  }

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return landmarker;
}

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = undefined;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = undefined;
  }

  video.srcObject = null;
  clearOverlay();
  startButton.disabled = false;
  stopButton.disabled = true;
  emptyState.classList.remove("hidden");
  setPresence("presence-idle", "Camera stopped");
  setViewerNotice("viewer-notice-idle", "Camera stopped");
  faceCount.textContent = "0";
  confidenceValue.textContent = "0%";
  updateHeadOrientation("Unavailable");
  updateEyeTracking("Unavailable");
}

function renderLoop() {
  if (!detector || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
    animationFrameId = requestAnimationFrame(renderLoop);
    return;
  }

  resizeCanvas();

  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    const timestamp = performance.now();
    const result = detector.detectForVideo(video, timestamp);
    const landmarkResult = landmarker ? landmarker.detectForVideo(video, timestamp) : { faceLandmarks: [] };
    const detections = result.detections || [];
    const faceLandmarks = landmarkResult.faceLandmarks?.[0];
    const primaryDetection = detections[0];
    const bestScore = detections.reduce((max, detection) => {
      return Math.max(max, detection.categories?.[0]?.score || 0);
    }, 0);

    drawDetections(detections);
    faceCount.textContent = String(detections.length);
    confidenceValue.textContent = `${Math.round(bestScore * 100)}%`;

    if (primaryDetection) {
      lastSeenAt = new Date();
      updateLastSeen();
      const orientationLabel = getHeadOrientation(primaryDetection);
      updateHeadOrientation(orientationLabel);
      updateEyeTracking(isLookingAtScreen(faceLandmarks, orientationLabel));
      setPresence("presence-ok", "Face in frame");
      setViewerNotice("viewer-notice-active", "Face detected in frame");
    } else {
      updateHeadOrientation("Unavailable");
      updateEyeTracking("Unavailable");
      setPresence("presence-warn", "No face detected");
      setViewerNotice("viewer-notice-warn", "Camera is on, but no face is visible");
    }
  }

  animationFrameId = requestAnimationFrame(renderLoop);
}

async function startCamera() {
  setError("");
  startButton.disabled = true;
  emptyState.classList.add("hidden");
  setPresence("presence-idle", "Starting camera");
  setViewerNotice("viewer-notice-idle", "Loading face detector and requesting camera access...");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support camera access.");
    }

    await ensureDetector();
    await ensureLandmarker();

    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    video.srcObject = cameraStream;
    await video.play();
    stopButton.disabled = false;
    setViewerNotice("viewer-notice-active", "Camera started. Looking for a face...");
    renderLoop();
  } catch (error) {
    stopCamera();
    setPresence("presence-warn", "Camera unavailable");
    setViewerNotice("viewer-notice-warn", "Camera could not be started");

    if (error?.name === "NotAllowedError") {
      setError("Camera permission was denied. Allow camera access and try again. If you are testing inside VS Code, try the same page in Safari or Chrome.");
      return;
    }

    setError(error.message || "Unable to start the camera preview.");
  }
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", () => {
  setError("");
  stopCamera();
});

window.addEventListener("beforeunload", stopCamera);

updateLastSeen();
setViewerNotice("viewer-notice-idle", "Waiting for camera");