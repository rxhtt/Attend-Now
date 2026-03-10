// App State
// App State
let currentView = 'home';
let isModelLoaded = false;
let modelsPath = 'models'; // Local assets
let labeledFaceDescriptors = [];
let currentSession = null;
let SHEET_API_URL = localStorage.getItem('sheet_api_url') || '';

// DOM Elements
const videoScan = document.getElementById('video-scan');
const videoRegister = document.getElementById('video-register');

// 1. Initialization
// 1. Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Simple Intro: Fade out splash after 2s
    const intro = document.getElementById('simple-intro');
    if (intro) {
        setTimeout(() => {
            intro.style.opacity = '0';
            setTimeout(() => intro.remove(), 500);
        }, 1500); // 1.5s visible
    }

    // Nav handling
    populateSettingsUI();
    await loadModels();
    loadLocalData();
    updateStats();

    // Auto-fill date
    const now = new Date();
    document.getElementById('session-date').value = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();

    // Register Button (Event Listener + Inline Backup)
    const btnReg = document.getElementById('btn-capture-register');
    if (btnReg) btnReg.addEventListener('click', handleRegistration);
});

function populateSettingsUI() {
    if (SHEET_API_URL) {
        document.getElementById('settings-sheet-url').value = SHEET_API_URL;
    }
    renderEnrolledList();
}

function renderEnrolledList() {
    const students = JSON.parse(localStorage.getItem('students') || '[]');
    const container = document.getElementById('enrolled-list');

    // Safety check if element exists (it's in HTML now)
    if (!container) return;

    if (students.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary); font-size:0.9rem;">No students enrolled yet.</p>';
        return;
    }

    container.innerHTML = '';
    students.forEach(s => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.marginBottom = '12px';
        div.style.borderBottom = '1px solid var(--border-color)';
        div.style.paddingBottom = '8px';

        // Use placeholder if image not saved (legacy support)
        const imgSrc = s.image || 'img/logo.png';

        div.innerHTML = `
            <img src="${imgSrc}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:12px; border:1px solid var(--border-color);">
            <div>
                <p style="font-weight:600; font-size:0.95rem;">${s.name}</p>
                <p style="font-size:0.8rem; color:var(--text-secondary);">${s.uucms}</p>
            </div>
        `;
        container.appendChild(div);
    });
}

window.saveSettingsFromPage = function () {
    const url = document.getElementById('settings-sheet-url').value;
    if (url) {
        SHEET_API_URL = url;
        localStorage.setItem('sheet_api_url', url);
        // Optional: Show value saved feedback
    }
};

// Deprecated modal settings functions replaced by page settings
// function checkSettings() ...
// function saveSettings() ...

// 2. Navigation
window.navigate = function (view) {
    // Hide all
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    // Show target
    document.getElementById(`view-${view}`).classList.add('active');

    // Update nav icon
    const navItems = document.querySelectorAll('.nav-item');
    if (view === 'home') navItems[0].classList.add('active');
    if (view === 'scan') navItems[1].classList.add('active');
    if (view === 'register') navItems[2].classList.add('active');
    if (view === 'logs') navItems[3].classList.add('active');
    if (view === 'settings') navItems[4].classList.add('active');

    // Camera logic
    if (view === 'scan') {
        if (!currentSession) {
            // Force session creation first if accessing scan directly
            showSessionModal();
        } else {
            startCamera(videoScan, 'scan');
        }
    } else if (view === 'register') {
        startCamera(videoRegister, 'register');
    } else {
        stopCamera();
    }

    if (view === 'logs') renderLogs();
    if (view === 'settings') populateSettingsUI(); // Ensure UI is sync

    currentView = view;
};

// 3. Models & Camera
async function loadModels() {
    try {
        // Optimized: Using TinyFaceDetector for mobile performance.
        await faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath);
        await faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath);
        await faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath);
        isModelLoaded = true;
        console.log("Models loaded successfully (Tiny)");
    } catch (e) {
        alert("Model Error: " + e.message);
    }
}

let activeStream = null;

async function startCamera(videoElement, mode) {
    stopCamera(); // Stop any previous
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        videoElement.srcObject = stream;
        activeStream = stream;

        videoElement.onloadedmetadata = () => {
            videoElement.play();
            if (mode === 'scan') startScanningLoop();
        };
    } catch (err) {
        console.error("Camera Error:", err);
        alert("Camera permission denied or not available.");
    }
}

function stopCamera() {
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
        activeStream = null;
    }
    if (scanInterval) clearInterval(scanInterval);
}

// 4. Registration Logic
window.handleRegistration = async function () {
    console.log("Register Clicked");
    if (!isModelLoaded) {
        // Fallback if models are taking too long
        return alert("Face Models are still loading... Please wait 5 seconds and try again.");
    }

    const uucms = document.getElementById('reg-uucms').value;
    const name = document.getElementById('reg-name').value;
    const branch = document.getElementById('reg-branch').value;
    const year = document.getElementById('reg-year').value;
    const sem = document.getElementById('reg-sem').value;

    if (!uucms || !name) return alert("Please fill UUCMS and Name");

    // Show Loading Overlay with Animation
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loadingText.innerText = "Initializing Camera...";
    overlay.classList.add('active');

    // Give UI time to render the overlay
    setTimeout(async () => {
        try {
            if (videoRegister.paused || videoRegister.ended || !videoRegister.srcObject) {
                throw new Error("Camera not ready. Please wait.");
            }

            loadingText.innerText = "Scanning Face...";

            // Detect face (Use TinyFaceDetector with HIGH input size for accuracy)
            // inputSize 512 or 608 is better for registration accuracy
            const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.5 });

            const detection = await faceapi.detectSingleFace(videoRegister, options)
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!detection) {
                overlay.classList.remove('active');
                return alert("Face not detected!\n\n1. Ensure good lighting.\n2. Remove glasses/masks.\n3. Hold still.");
            }

            loadingText.innerText = "Encoding Biometrics...";

            // Allow a brief moment for the user to see the "Encoding" status
            await new Promise(r => setTimeout(r, 500));

            // Save Data
            const descriptor = Array.from(detection.descriptor);

            // Capture Image Snapshot
            const canvas = document.createElement('canvas');
            canvas.width = videoRegister.videoWidth;
            canvas.height = videoRegister.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoRegister, 0, 0, canvas.width, canvas.height);
            const faceImg = canvas.toDataURL('image/jpeg', 0.7); // Higher quality for profile

            const studentData = {
                uucms, name, branch, year, sem, descriptor, image: faceImg
            };

            // Save Local
            let students = JSON.parse(localStorage.getItem('students') || '[]');
            students.push(studentData);
            localStorage.setItem('students', JSON.stringify(students));

            // Update matchers
            labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(
                JSON.stringify({ name: name, uucms: uucms }),
                [detection.descriptor]
            ));

            // Async Upload
            uploadToSheet('register', studentData);

            loadingText.innerText = "Success!";

            setTimeout(() => {
                overlay.classList.remove('active');
                navigate('home');
                updateStats();
            }, 1000);

        } catch (e) {
            overlay.classList.remove('active');
            console.error(e);
            alert("Registration Error: " + e.message);
        }
    }, 100); // 100ms delay to let the overlay paint
}

// 5. Attendance Session & Scanning
window.showSessionModal = function () {
    document.getElementById('session-modal').classList.add('active');
    // Update date
    const now = new Date();
    document.getElementById('session-date').value = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
};

window.startSession = function () {
    const sessionName = document.getElementById('session-name').value;
    const teacherName = document.getElementById('session-teacher').value;
    const date = document.getElementById('session-date').value;

    if (!sessionName || !teacherName) return alert("Fill all session details.");

    currentSession = { sessionName, teacherName, date };
    document.getElementById('session-modal').classList.remove('active');
    document.getElementById('session-info-display').innerText = `${sessionName} • ${teacherName}`;

    navigate('scan');
};

window.endSession = function () {
    if (!confirm("Are you sure you want to end this session?")) return;
    stopCamera();
    currentSession = null;
    navigate('home');
};

let scanInterval;
async function startScanningLoop() {
    if (!activeStream) return;

    const canvas = document.getElementById('canvas-scan');
    const displaySize = { width: videoScan.videoWidth, height: videoScan.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);

    // Performance Update: Detect every 200ms with TinyFaceDetector
    // Tiny is fast enough for near real-time. 320 input size is good balance.
    scanInterval = setInterval(async () => {
        if (!activeStream || videoScan.paused || videoScan.ended) return;

        // Detect using TinyFaceDetector
        const detections = await faceapi.detectAllFaces(
            videoScan,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
        )
            .withFaceLandmarks()
            .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        // Clear canvas
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (labeledFaceDescriptors.length === 0) return;

        // Tiny needs a slightly strict threshold to avoid false positives (0.55 or 0.5)
        const faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.55);

        resizedDetections.forEach(d => {
            const result = faceMatcher.findBestMatch(d.descriptor);
            const box = d.detection.box;

            // Draw box
            const drawBox = new faceapi.draw.DrawBox(box, { label: result.toString() });
            drawBox.draw(canvas);

            if (result.label !== 'unknown') {
                try {
                    const info = JSON.parse(result.label);
                    markAttendance(info);
                } catch (e) {
                    console.log("Legacy label:", result.label);
                }
            }
        });

    }, 200); // 200ms is standard for "real-time" feel without melting CPU
}

// 6. Mark Attendance
function markAttendance(studentInfo) {
    // Debounce
    const now = new Date();
    let logs = JSON.parse(localStorage.getItem('attendance_logs') || '[]');

    // Check if recently scanned in this session (e.g. last 5 mins)
    const recent = logs.find(l => l.uucms === studentInfo.uucms && l.session === currentSession.sessionName && (now - new Date(l.timestamp)) < 300000); // 5 mins

    if (recent) return; // Already marked recently

    const log = {
        name: studentInfo.name,
        uucms: studentInfo.uucms,
        session: currentSession.sessionName,
        teacher: currentSession.teacherName,
        date: currentSession.date,
        timestamp: now.toISOString()
    };

    logs.unshift(log); // Add to top
    localStorage.setItem('attendance_logs', JSON.stringify(logs));

    // Visual feedback
    document.getElementById('scan-status').innerText = `Marked: ${studentInfo.name}`;
    document.getElementById('scan-status').style.color = 'var(--success-color)';
    setTimeout(() => {
        document.getElementById('scan-status').innerText = 'Scanning...';
        document.getElementById('scan-status').style.color = 'var(--text-primary)';
    }, 2000);

    // Upload
    uploadToSheet('attendance', {
        studentName: studentInfo.name,
        uucms: studentInfo.uucms,
        session: currentSession.sessionName,
        teacher: currentSession.teacherName,
        date: currentSession.date
    });
}

// 7. Utils
// 7. Utils
window.exportLogs = async function () {
    const logs = JSON.parse(localStorage.getItem('attendance_logs') || '[]');
    if (logs.length === 0) return alert("No logs to export.");

    let csvContent = "Name,UUCMS,Session,Teacher,Date,Time\n";
    logs.forEach(l => {
        const time = new Date(l.timestamp).toLocaleTimeString();
        const safeName = l.name ? l.name.replace(/,/g, '') : 'Unknown';
        csvContent += `${safeName},${l.uucms},${l.session},${l.teacher},${l.date},${time}\n`;
    });

    try {
        const fileName = `attendance_${new Date().getTime()}.csv`;

        // 1. Try Native Capacitor Share (Best for Android)
        if (window.Capacitor && window.Capacitor.Plugins) {
            const { Filesystem, Share } = window.Capacitor.Plugins;

            // Write to cache
            const writeResult = await Filesystem.writeFile({
                path: fileName,
                data: csvContent,
                directory: 'CACHE',
                encoding: 'utf8'
            });

            // Share file URI
            await Share.share({
                title: 'Attendance Export',
                text: 'Here is the attendance CSV file.',
                url: writeResult.uri,
                dialogTitle: 'Share CSV'
            });

            return;
        }

        // 2. Fallback: Web Share API (File)
        if (navigator.share) {
            const file = new File([csvContent], fileName, { type: "text/csv" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: 'Attendance Logs',
                    text: 'Attendance CSV'
                });
                return;
            }
        }

        // 3. Fallback: Clipboard (Last Resort)
        fallbackCopy(csvContent);

    } catch (e) {
        console.error("Export failed:", e);
        alert("Export failed using Share. Copying to clipboard instead.");
        fallbackCopy(csvContent);
    }
};

function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        alert("CSV Report copied to clipboard! Paste it in a note or email.");
    } catch (err) {
        alert("Could not export. Please take a screenshot of the logs.");
    }
    document.body.removeChild(textArea);
}

function fallbackDownload(csv) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${new Date().getTime()}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 100);
}

function loadLocalData() {
    const students = JSON.parse(localStorage.getItem('students') || '[]');
    labeledFaceDescriptors = students.map(s => {
        const descriptor = new Float32Array(s.descriptor);
        return new faceapi.LabeledFaceDescriptors(
            JSON.stringify({ name: s.name, uucms: s.uucms }),
            [descriptor]
        );
    });
}

function updateStats() {
    const students = JSON.parse(localStorage.getItem('students') || '[]');
    const logs = JSON.parse(localStorage.getItem('attendance_logs') || '[]');

    document.getElementById('stat-students').innerText = students.length;

    // Today's Unique Attendance (Based on UUCMS)
    const today = new Date().toDateString();

    // Get unique UUCMS from logs that match today's date
    const todayLogs = logs.filter(l => new Date(l.timestamp).toDateString() === today);
    const uniqueStudents = new Set(todayLogs.map(l => l.uucms));

    document.getElementById('stat-attendance').innerText = uniqueStudents.size;
}

function renderLogs() {
    const logs = JSON.parse(localStorage.getItem('attendance_logs') || '[]');
    const container = document.getElementById('logs-list');
    container.innerHTML = '';

    logs.forEach(l => {
        const div = document.createElement('div');
        div.className = 'log-item';
        div.innerHTML = `
            <div class="log-info">
                <h4>${l.name}</h4>
                <p>${l.uucms} • ${new Date(l.timestamp).toLocaleTimeString()}</p>
                <p style="font-size:0.7rem; color:var(--text-secondary)">${l.session}</p>
            </div>
            <div class="status-badge">Present</div>
        `;
        container.appendChild(div);
    });
}

function uploadToSheet(type, data) {
    if (!SHEET_API_URL) return;

    const payload = {
        type: type,
        ...data
    };

    fetch(SHEET_API_URL, {
        method: 'POST',
        mode: 'no-cors', // Important for Google Apps Script
        body: JSON.stringify(payload)
    }).catch(err => console.error("Sync Error", err));
}
