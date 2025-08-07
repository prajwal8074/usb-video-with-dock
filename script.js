// DOM Elements
const video = document.getElementById('cameraFeed');
const messageBox = document.getElementById('messageBox');
const cameraSelect = document.getElementById('cameraSelect');
const fullscreenButton = document.getElementById('fullscreenButton');
const mainContentWrapper = document.getElementById('mainContentWrapper');
const fpsDisplay = document.getElementById('fpsDisplay');
const tempDisplay = document.getElementById('tempDisplay');
const wifiSpeedDisplay = document.getElementById('wifiSpeedDisplay');
const volumeSlider = document.getElementById('volumeSlider');
const recordButton = document.getElementById('recordButton');
const recordButtonText = document.getElementById('recordButtonText');
const screenshotButton = document.getElementById('screenshotButton');
const mediaNextButton = document.getElementById('mediaNextButton');
const mediaPauseButton = document.getElementById('mediaPauseButton');
const mediaPrevButton = document.getElementById('mediaPrevButton');
const youtubeRewindButton = document.getElementById('youtubeRewindButton');
const youtubeForwardButton = document.getElementById('youtubeForwardButton');
const audioSelect = document.getElementById('audioSelect');

// State
let currentStream, messageTimeoutId, fpsCallbackId, mediaRecorder;
let frameTimestamps = [], recordedChunks = [], isRecording = false;
let lastControlledTabId = null; // Keep track of the last tab we sent a command to

// SVG Icons for Play/Pause button
const playIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>`;
const pauseIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>`;


// --- Utility Functions ---
function showMessage(message, type = 'info', duration = 3000) {
    if (messageTimeoutId) clearTimeout(messageTimeoutId);
    messageBox.textContent = message;
    messageBox.style.display = 'block';
    messageBox.style.backgroundColor = type === 'error' ? 'rgba(220, 38, 38, 0.8)' : 'rgba(0, 0, 0, 0.8)';
    if (duration > 0) messageTimeoutId = setTimeout(() => messageBox.style.display = 'none', duration);
}

// --- Camera & FPS Logic ---
function stopCurrentStream() {
    if (currentStream) currentStream.getTracks().forEach(track => track.stop());
    if (fpsCallbackId) video.cancelVideoFrameCallback(fpsCallbackId);
    currentStream = null;
    fpsCallbackId = null;
    fpsDisplay.textContent = 'FPS: N/A';
}

function startAccurateFpsCounter() {
    frameTimestamps = [];
    const cb = now => {
        const oneSecAgo = now - 1000;
        frameTimestamps = frameTimestamps.filter(t => t > oneSecAgo);
        frameTimestamps.push(now);
        fpsDisplay.textContent = `FPS: ${frameTimestamps.length}`;
        if (video.srcObject) fpsCallbackId = video.requestVideoFrameCallback(cb);
    };
    if (video.readyState >= 2) fpsCallbackId = video.requestVideoFrameCallback(cb);
}

async function getMediaDevices() {
    let tempStream = null;
    try {
        // Request both to get permissions and a full device list
        tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Clear existing options
        cameraSelect.innerHTML = '';
        audioSelect.innerHTML = '';

        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        const audioDevices = devices.filter(d => d.kind === 'audioinput');

        if (videoDevices.length === 0) {
            showMessage('No cameras found.', 'error');
        } else {
            videoDevices.forEach(d => {
                const option = document.createElement('option');
                option.value = d.deviceId;
                option.textContent = d.label || `Camera ${cameraSelect.options.length + 1}`;
                cameraSelect.appendChild(option);
            });
        }

        if (audioDevices.length === 0) {
            showMessage('No audio input devices found.', 'error');
        } else {
            audioDevices.forEach(d => {
                const option = document.createElement('option');
                option.value = d.deviceId;
                option.textContent = d.label || `Audio Input ${audioSelect.options.length + 1}`;
                // Prioritize capture card audio
                if (d.label.toLowerCase().includes('capture') || d.label.toLowerCase().includes('hdmi')) {
                    option.selected = true;
                }
                audioSelect.appendChild(option);
            });
        }
        
        // Start the stream with the default or selected devices
        if (videoDevices.length > 0 && audioDevices.length > 0) {
            startStream(cameraSelect.value, audioSelect.value);
        }

    } catch (err) {
        showMessage(`Could not list devices: ${err.name}: ${err.message}`, 'error');
        // If permission was denied, explain how to fix it
        if (err.name === "NotAllowedError") {
             showMessage('Camera/Mic permission denied. Please allow access in your browser settings.', 'error', 10000);
        }
    } finally {
        // Stop the temporary stream used to get permissions
        if (tempStream) tempStream.getTracks().forEach(track => track.stop());
    }
}


// In script.js, replace the entire startStream function with this one:

async function startStream(videoDeviceId, audioDeviceId) {
    stopCurrentStream(); // This function already exists and works as is

    // Define advanced audio constraints for high-quality, low-latency sound
    const constraints = {
        video: {
            deviceId: { exact: videoDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        audio: {
            deviceId: { exact: audioDeviceId },
            // --- Key Audio Quality Optimizations ---

            // 1. Disable processing that degrades non-voice audio
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,

            // 2. Request a standard high sample rate
            sampleRate: { ideal: 48000 },

            // 3. Prioritize low latency to reduce stuttering
            latency: { ideal: 0.01 }
        }
    };

    try {
        // Attempt to get the stream with our ideal settings
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;
        video.muted = false; // Ensure audio is audible
        video.onloadedmetadata = () => {
            video.play();
            startAccurateFpsCounter(); // This function already exists
        };
    } catch (err) {
        showMessage(`Error starting stream: ${err.message}`, 'error');

        // If the advanced settings are not supported, try again with basic settings
        if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
             showMessage('Advanced audio settings not supported. Retrying with defaults...', 'info', 5000);
             const fallbackConstraints = {
                 video: constraints.video,
                 audio: { deviceId: { exact: audioDeviceId } }
             };
             try {
                currentStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
                video.srcObject = currentStream;
                video.muted = false;
                video.onloadedmetadata = () => video.play();
             } catch (fallbackErr) {
                showMessage(`Fallback stream failed: ${fallbackErr.message}`, 'error');
             }
        }
    }
}

function takeTabScreenshot() {
    if (!currentStream || !video.videoWidth) { showMessage('Camera not active.', 'error'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `capture-${Date.now()}.png`;
    link.click();
    showMessage('Screenshot saved!', 'info', 2000);
}

// --- Chrome Extension API & System Info Functions ---
function getCPUInfo() {
    if (!chrome.system || !chrome.system.cpu) return;
    chrome.system.cpu.getInfo(cpu => {
        if (chrome.runtime.lastError || !cpu.temperatures || cpu.temperatures.length === 0) {
            tempDisplay.textContent = "Temp: N/A"; return;
        }
        tempDisplay.textContent = `Temp: ${cpu.temperatures[0]}°C`;
    });
}

function getNetworkSpeed() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection && connection.downlink) {
        // downlink is in Mbps
        wifiSpeedDisplay.textContent = `WiFi: ${connection.downlink.toFixed(2)} Mbps`;
    } else {
        wifiSpeedDisplay.textContent = 'WiFi: N/A';
    }
}

// --- Recording Functions ---
function startRecording() {
    if (!currentStream) { showMessage('Camera not active.', 'error'); return; }
    isRecording = true;
    recordButton.classList.add('is-recording');
    recordButtonText.textContent = 'Stop';
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(currentStream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = event => { if (event.data.size > 0) recordedChunks.push(event.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage('Recording saved!', 'info');
    };
    mediaRecorder.start();
}

function stopRecording() {
    if (mediaRecorder) mediaRecorder.stop();
    isRecording = false;
    recordButton.classList.remove('is-recording');
    recordButtonText.textContent = 'Record';
}

// --- Generic Media Control Functions ---
function findAndExecuteScript(script, args, successCallback) {
    const executeOnTab = (tab) => {
        lastControlledTabId = tab.id;
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: script,
            args: args || []
        }, (results) => {
            if (chrome.runtime.lastError) {
                // If the tab was closed or we lost permission, invalidate the ID
                if (chrome.runtime.lastError.message.includes("No tab with id")) {
                    lastControlledTabId = null;
                }
                console.error(chrome.runtime.lastError.message);
                return;
            }
            if (successCallback) successCallback(results, tab);
        });
    };

    // 1. Try the last controlled tab first
    if (lastControlledTabId) {
        chrome.tabs.get(lastControlledTabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
                lastControlledTabId = null; // Tab is gone, clear the ID
                findAndExecuteScript(script, args, successCallback); // Retry without the ID
            } else {
                executeOnTab(tab);
            }
        });
        return;
    }

    // 2. If no last tab, try the active YouTube tab
    chrome.tabs.query({ active: true, url: "*://*.youtube.com/*" }, (tabs) => {
        if (tabs.length > 0) {
            executeOnTab(tabs[0]);
        } else {
            // 3. Fallback to any tab playing audio
            chrome.tabs.query({ audible: true }, (audibleTabs) => {
                if (audibleTabs.length > 0) {
                    executeOnTab(audibleTabs[0]);
                } else {
                    showMessage('No active media tab found.', 'error');
                }
            });
        }
    });
}

// --- Specific Media Actions ---

function setMediaVolume(level) {
    // Also control local video feed volume
    video.volume = level;

    const setVolumeScript = (vol) => {
        const videoEl = document.querySelector('video');
        if (videoEl) {
            videoEl.volume = vol;
            return true;
        }
        return false;
    };
    findAndExecuteScript(setVolumeScript, [level]);
}

function toggleMediaPlayback() {
    const togglePlaybackScript = () => {
        const videoEl = document.querySelector('video');
        if (!videoEl) return null;
        if (videoEl.paused) {
            videoEl.play();
        } else {
            videoEl.pause();
        }
        return videoEl.paused;
    };

    findAndExecuteScript(togglePlaybackScript, [], (results, tab) => {
        if (results && results[0].result !== null) {
            const isPaused = results[0].result;
            mediaPauseButton.innerHTML = isPaused ? playIconSVG : pauseIconSVG;
            showMessage(`Toggled playback on: ${tab.title.substring(0, 20)}...`, 'info');
        } else {
            showMessage('Could not find video on tab.', 'error');
        }
    });
}

function seekOnYoutube(direction) {
    const seekScript = (dir) => {
        const videoEl = document.querySelector('video');
        if (!videoEl) return false;
        videoEl.currentTime += (dir === 'forward' ? 10 : -10);
        return true;
    };
    findAndExecuteScript(seekScript, [direction], (results, tab) => {
        if (results && results[0].result) {
            showMessage(`Seek ${direction} on ${tab.title.substring(0,20)}...`, 'info');
        } else {
            showMessage('Could not seek on YouTube tab.', 'error');
        }
    });
}

function goBackInHistory() {
    const goBackScript = () => {
        window.history.back();
        return true;
    };
    findAndExecuteScript(goBackScript, [], (results, tab) => {
        if (results && results[0] && results[0].result) {
            showMessage(`Navigating back on ${tab.title.substring(0,20)}...`, 'info');
        } else {
            showMessage(`Could not navigate back.`, 'error');
        }
    });
}

function skipMedia() {
    const clickButtonScript = () => {
        // "Previous" selectors have been removed
        const nextSelectors = ['.ytp-next-button', 'button[data-testid="control-button-skip-forward"]', 'button[aria-label*="Next"]', 'button[aria-label*="Skip"]'];
        for (const selector of nextSelectors) {
            const btn = document.querySelector(selector);
            if (btn) {
                btn.click();
                return true;
            }
        }
        return false;
    };

    findAndExecuteScript(clickButtonScript, [], (results, tab) => {
        if (results && results[0] && results[0].result) {
            showMessage(`Skipped to next on ${tab.title.substring(0,20)}...`, 'info');
        } else {
            showMessage(`Could not find a "next" button.`, 'error');
        }
    });
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    // This single function now handles getting all devices and starting the stream
    getMediaDevices(); 
    
    getCPUInfo();
    setInterval(getCPUInfo, 5000);

    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
        getNetworkSpeed();
        connection.addEventListener('change', getNetworkSpeed);
        setInterval(getNetworkSpeed, 5000);
    } else {
        wifiSpeedDisplay.textContent = 'WiFi: N/A';
    }

    mediaPauseButton.innerHTML = pauseIconSVG;
});

// This function starts a new stream whenever the selection changes for either device
function handleDeviceChange() {
    startStream(cameraSelect.value, audioSelect.value);
}

fullscreenButton.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        mainContentWrapper.requestFullscreen().catch(err => {
            showMessage(`Error entering fullscreen: ${err.message}`, 'error');
        });
    } else {
        document.exitFullscreen();
    }
});

volumeSlider.addEventListener('input', e => setMediaVolume(parseFloat(e.target.value)));
screenshotButton.addEventListener('click', takeTabScreenshot);
recordButton.addEventListener('click', () => isRecording ? stopRecording() : startRecording());

// Media Control Listeners
mediaPauseButton.addEventListener('click', toggleMediaPlayback);
mediaNextButton.addEventListener('click', skipMedia); // No longer needs an argument
mediaPrevButton.addEventListener('click', goBackInHistory); // Call the new function
youtubeRewindButton.addEventListener('click', () => seekOnYoutube('backward'));
youtubeForwardButton.addEventListener('click', () => seekOnYoutube('forward'));
cameraSelect.addEventListener('change', handleDeviceChange);
audioSelect.addEventListener('change', handleDeviceChange);
