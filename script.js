// DOM Elements
        const video = document.getElementById('cameraFeed');
        const messageBox = document.getElementById('messageBox');
        const cameraSelect = document.getElementById('cameraSelect');
        const fullscreenButton = document.getElementById('fullscreenButton');
        const mainContentWrapper = document.getElementById('mainContentWrapper');
        const fpsDisplay = document.getElementById('fpsDisplay');
        const tempDisplay = document.getElementById('tempDisplay');
        const volumeSlider = document.getElementById('volumeSlider');
        const brightnessSlider = document.getElementById('brightnessSlider');
        const recordButton = document.getElementById('recordButton');
        const recordButtonText = document.getElementById('recordButtonText');
        const screenshotButton = document.getElementById('screenshotButton');
        const mediaNextButton = document.getElementById('mediaNextButton');

        // State
        let currentStream, messageTimeoutId, fpsCallbackId, mediaRecorder;
        let frameTimestamps = [], recordedChunks = [], isRecording = false;

        // --- Utility Functions ---
        function showMessage(message, type = 'info', duration = 3000) {
            if (messageTimeoutId) clearTimeout(messageTimeoutId);
            messageBox.textContent = message;
            messageBox.style.display = 'block';
            messageBox.style.backgroundColor = type === 'error' ? 'rgba(220, 38, 38, 0.8)' : 'rgba(0, 0, 0, 0.8)';
            if (duration > 0) messageTimeoutId = setTimeout(() => messageBox.style.display = 'none', duration);
        }

        function updateSliderFill(slider) {
            const percentage = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
            slider.style.setProperty('--fill-percent', `${percentage}%`);
        }

        // ADD THIS NEW FUNCTION
        function setupInteractiveSlider(slider) {
            const setValueFromEvent = (e) => {
                const rect = slider.getBoundingClientRect();
                // Calculate click position as a percentage from the bottom (0.0) to the top (1.0)
                const percentage = Math.max(0, Math.min(1, (rect.bottom - e.clientY) / rect.height));
        
                const min = parseFloat(slider.min);
                const max = parseFloat(slider.max);
        
                // Set the slider's value based on the calculated percentage
                slider.value = min + (max - min) * percentage;
        
                // Manually trigger the 'input' event so that other listeners will fire
                slider.dispatchEvent(new Event('input'));
            };
        
            slider.addEventListener('pointerdown', (e) => {
                setValueFromEvent(e); // Set value on initial click
        
                const onPointerMove = (moveEvent) => {
                    setValueFromEvent(moveEvent);
                };
        
                const onPointerUp = () => {
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                };
        
                // Add listeners to the window to handle dragging outside the slider
                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
            });
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

        async function startCamera(deviceId) {
            stopCurrentStream();
            const constraints = {
                video: {
                    deviceId: deviceId ? { exact: deviceId } : undefined, // Add this line
                    width: { ideal: 1600 },
                    height: { ideal: 1200 }
                }
            };
            try {
                currentStream = await navigator.mediaDevices.getUserMedia(constraints);
                video.srcObject = currentStream;
                video.onloadedmetadata = () => { video.play(); startAccurateFpsCounter(); };
            } catch (err) {
                showMessage(`Error starting camera: ${err.message}`, 'error');
            }
        }
        
        function takeTabScreenshot() {
            // UPDATED: This function now captures only the video frame, not the docks.
            if (!currentStream || !video.videoWidth) {
                showMessage('Camera not active.', 'error');
                return;
            }
        
            // Create an in-memory canvas to draw the video frame on
            const canvas = document.createElement('canvas');
            // Set canvas dimensions to the video's actual resolution
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        
            // Draw the current video frame to the canvas
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
            // Create a download link from the canvas data
            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `capture-${Date.now()}.png`;
            link.click();
            showMessage('Screenshot saved!', 'info', 2000);
        }

        async function getCameras() {
            let tempStream = null; // Variable to hold the temporary stream
            try {
                // Get a temporary stream to trigger the permission prompt
                tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
                cameraSelect.innerHTML = '';
                if (videoDevices.length === 0) {
                    showMessage('No cameras found.', 'error');
                    return;
                }
                
                videoDevices.forEach(d => {
                    const option = document.createElement('option');
                    option.value = d.deviceId;
                    option.textContent = d.label || `Camera ${cameraSelect.options.length + 1}`;
                    cameraSelect.appendChild(option);
                });
                // Start the selected camera
                startCamera(cameraSelect.value);
            } catch (err) {
                showMessage(`Could not list cameras: ${err.name}: ${err.message}`, 'error');
                console.error(err);
            } finally {
                // CRUCIAL: Always stop the temporary stream tracks to turn off the camera light
                if (tempStream) {
                    tempStream.getTracks().forEach(track => track.stop());
                }
            }
        }

        // --- Chrome Extension API Functions ---
        function getCPUInfo() {
            if (!chrome.system || !chrome.system.cpu) return;
            chrome.system.cpu.getInfo(cpu => {
                if (chrome.runtime.lastError || !cpu.temperatures || cpu.temperatures.length === 0) {
                    tempDisplay.textContent = "Temp: N/A"; return;
                }
                tempDisplay.textContent = `Temp: ${cpu.temperatures[0]}°C`;
            });
        }

        function setSystemBrightness(level) {
            // if (!chrome.system || !chrome.system.display) return;
            // chrome.system.display.getInfo(d => {
            //     if (!chrome.runtime.lastError) chrome.system.display.setDisplayProperties(d[0].id, { brightness: level });
            // });
        }

        function startRecording() {
            if (!currentStream) {
                showMessage('Camera not active.', 'error');
                return;
            }
            isRecording = true;
            recordButton.classList.add('is-recording');
            recordButtonText.textContent = 'Stop Recording';
            recordedChunks = [];
            
            // Note: Recording the camera stream, not the tab.
            mediaRecorder = new MediaRecorder(currentStream, { mimeType: 'video/webm' });
            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) recordedChunks.push(event.data);
            };
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

        function triggerMediaNext() {
            chrome.tabs.query({ audible: true }, (tabs) => {
                if (tabs.length === 0) { showMessage('No tab is playing audio.', 'info', 2000); return; }
                const targetTab = tabs[0];
                chrome.scripting.executeScript({
                    target: { tabId: targetTab.id },
                    function: clickNextButtonOnPage,
                }, (results) => {
                    if (chrome.runtime.lastError || !results || !results[0].result) {
                        showMessage('Could not find a "next" button on the active media tab.', 'error');
                    } else {
                        showMessage(`Skipped track on: ${targetTab.title.substring(0, 20)}...`, 'info');
                    }
                });
            });
        }

        // This function is injected into the media tab
        // This function is injected into the media tab
        function clickNextButtonOnPage() {
            const selectors = [
                // High-specificity selectors for major sites
                '.ytp-next-button',                              // YouTube
                'button[data-testid="control-button-skip-forward"]', // Spotify
                '.player-controls__right button:nth-child(2)',   // YouTube Music
                'button.buttons-player-next',                    // Apple Music
        
                // Generic attribute-based selectors
                'button[aria-label*="Next"]', 'button[aria-label*="next"]',
                'button[aria-label*="Skip"]', 'button[title*="Next"]',
                'button[title*="next"]', 'button[data-testid*="next"]'
            ];
        
            for (const selector of selectors) {
                const buttons = document.querySelectorAll(selector);
                for (const btn of buttons) {
                    // Check if the button is actually visible and clickable
                    const style = window.getComputedStyle(btn);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && !btn.disabled) {
                        btn.click();
                        return true; // Indicate success
                    }
                }
            }
            return false; // Indicate failure
        }

        // --- Event Listeners ---
        document.addEventListener('DOMContentLoaded', () => {
            // Initial setup
            getCameras();
            setInterval(getCPUInfo, 5000);
        });

        cameraSelect.addEventListener('change', () => startCamera(cameraSelect.value));
        
        fullscreenButton.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                mainContentWrapper.requestFullscreen().catch(err => {
                    showMessage(`Error entering fullscreen: ${err.message}`, 'error');
                });
            } else {
                document.exitFullscreen();
            }
        });

        volumeSlider.addEventListener('input', e => { video.volume = e.target.value; });
        brightnessSlider.addEventListener('input', e => setSystemBrightness(parseInt(e.target.value)));
        
        screenshotButton.addEventListener('click', takeTabScreenshot);
        mediaNextButton.addEventListener('click', triggerMediaNext);
        recordButton.addEventListener('click', () => {
            isRecording ? stopRecording() : startRecording();
        });