# EKG Lens AI Mobile — Standalone PWA

A mobile-friendly, installable ECG learning and interpretation prototype. It combines camera capture, image magnification, ECG-grid measurements, calculation tools, and cautious multi-agent AI review.

## What changed in this version

- **Connect AI screen inside the app**
  - Password-style API-key field
  - Show/hide control
  - Model selector
  - “Use key this session,” “Test connection,” and “Forget key” controls
  - The personal key is held only in browser memory and is forgotten on refresh or close
- **Two connection options**
  1. Personal session key entered in the app
  2. More secure server key configured with `OPENAI_API_KEY`
- **Installable mobile PWA**
  - Home-screen installation
  - Standalone display mode
  - Offline access to the viewer, rhythm simulator, and manual measurement interface
  - AI interpretation still requires internet access
- **One-click start files** for Windows and macOS/Linux
- Original EKG rhythm simulator included at `/practice.html`

## Main features

- Rear-camera preference with `getUserMedia()`
- Mobile image upload with `capture="environment"`
- Clickable and pinnable magnifying lens
- Zoom, rotate, pan, brightness, contrast, and tracing enhancement
- Paper-grid calibration by selecting one small ECG box
- RR, PR, QRS, QT, ST amplitude, time, and voltage measurements
- Automatic heart-rate calculation
- QTc Bazett and QTc Fridericia calculations
- Fast integrated AI review or multi-agent workflow:
  1. Signal Analyst
  2. Differential Challenger
  3. Clinical Safety Reviewer
  4. Senior Synthesis Agent
- Follow-up discussion about calculations, differential diagnoses, artifacts, urgency, and reasons an interpretation may be wrong

## Start on Windows

1. Install Node.js 18 or newer.
2. Extract the ZIP.
3. Double-click:

```text
start-windows.bat
```

4. Open:

```text
http://localhost:8787
```

5. Open **Connect AI**, paste your personal API key, select a model, and press **Test connection**.

## Start on macOS or Linux

```bash
cd ekg_lens_ai_mobile_standalone
./start-mac-linux.sh
```

Or:

```bash
npm start
```

Then open `http://localhost:8787`.

## Recommended secure server-key mode

For a shared, deployed, or production-style installation, do not ask users to paste a secret key into the browser. Configure it on the server instead.

### Windows PowerShell

```powershell
$env:OPENAI_API_KEY="your_key_here"
$env:OPENAI_MODEL="gpt-5.6"
npm start
```

### macOS or Linux

```bash
export OPENAI_API_KEY="your_key_here"
export OPENAI_MODEL="gpt-5.6"
npm start
```

The in-app personal-key option is intended for a private local prototype. The app does not write the personal key to disk, cookies, local storage, or the server filesystem; it sends the key with each request to the included local server.

## Install on a phone

The PWA must be served through **HTTPS** for normal mobile camera permissions and installation.

- **iPhone/iPad:** open in Safari → Share → **Add to Home Screen**
- **Android:** open in Chrome → menu → **Install app** or **Add to Home screen**

The upload button can invoke the phone camera on many devices even when live camera permission is unavailable.

## Privacy and medical limitations

- Do not enter names, birth dates, medical-record numbers, addresses, or other patient identifiers.
- Uploaded images are held in memory and are not written to disk by the included server.
- With AI enabled, the image and clinical context are transmitted to OpenAI for processing.
- This app is an educational prototype, not a validated diagnostic medical device.
- It cannot safely exclude myocardial infarction, dangerous arrhythmia, pulmonary embolism, electrolyte emergencies, or other acute disease from an ECG photograph.
- It does not provide individualized prescription dosing or replace professional ECG review, examination, serial tracings, or laboratory testing.
