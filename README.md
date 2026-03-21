<div align="center">

# 📹 Mulle — موله

**تماس ویدیویی گروهی امن | Secure Group Video Calls**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-black)](https://socket.io)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P-blue)](https://webrtc.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

**Developer:** [6arshid](https://github.com/6arshid/)
**Repository:** [Hostinger-WebRTC-live-video-chat](https://github.com/6arshid/Hostinger-WebRTC-live-video-chat)

</div>

---

## 🇬🇧 English

### About

**Mulle** is an open-source group video calling system built on Node.js.  
No registration, no app install, end-to-end encrypted.

### Features

| Feature | Description |
|---------|-------------|
| 🎥 **HD Video & Audio** | VP9/H264 + Opus codecs, P2P |
| 🔒 **E2E Encryption** | WebRTC DTLS/SRTP — server never sees content |
| 🖥️ **Screen Share** | With system audio |
| 🎨 **AI Virtual Background** | MediaPipe in-browser segmentation |
| 📺 **YouTube Live** | Stream directly with your Stream Key |
| ⏺️ **Session Recording** | WebM with mixed audio |
| 👑 **Owner Controls** | Approve entry, mute, kick |
| ⧉ **Picture in Picture** | Floating video window |
| 🌐/🔒 **Public/Private Rooms** | Open or approval-required |
| 🌍 **Bilingual** | Persian (FA) and English (EN) |
| 📱 **Responsive** | Mobile, tablet, desktop |

### Installation

#### Requirements
- Node.js 18+
- Open port `3000/tcp` (or 443)

#### Quick Start

```bash
git clone https://github.com/6arshid/Hostinger-WebRTC-live-video-chat.git
cd Hostinger-WebRTC-live-video-chat
npm install
npm start
```

#### Hostinger Node.js Hosting

```
hPanel → Node.js:
  Entry file: server.js
  Node version: 18+
  → Install Dependencies → Start
```

#### Environment Variables

```bash
PORT=3000
SSL_CERT=/path/to/fullchain.pem
SSL_KEY=/path/to/privkey.pem
NODE_ENV=production
ALLOWED_ORIGIN=https://yourdomain.com
```

### YouTube Live Streaming

#### Method 1: Browser Button
1. Join a room as owner
2. Click **📺 Live** button
3. Enter your **Stream Key** from YouTube Studio:
   - `YouTube Studio` → `Go Live` → `Stream` → Copy stream key
4. Click **▶ Start Streaming**

> **Note:** Browsers cannot push RTMP directly. Use Method 2 for actual streaming.

#### Method 2: ffmpeg (Recommended)

```bash
ffmpeg -f avfoundation -i "default" \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -c:a aac -b:a 128k \
  -f flv rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY
```

#### Method 3: OBS Studio (Easiest)
1. Open OBS → `Settings` → `Stream` → `YouTube RTMPS`
2. Paste your Stream Key
3. `Add Source` → `Browser` → enter Mulle room URL
4. Start Streaming

### Security Features

- ✅ Content Security Policy headers
- ✅ X-Frame-Options: DENY (anti-clickjacking)
- ✅ IP-based Rate Limiting
- ✅ Input Sanitization on all socket events
- ✅ Slug Validation (regex-enforced)
- ✅ Signal relay restricted to room peers only
- ✅ 64KB max WebSocket payload
- ✅ Auto room cleanup 10min after owner leaves
- ✅ HTTPS redirect in production mode

### File Structure

```
mulle/
├── server.js          ← Secure signaling server
├── package.json       ← express + socket.io only
└── public/
    ├── index.html     ← Bilingual UI (FA/EN)
    ├── client.js      ← WebRTC + YouTube Live + Virtual BG
    └── i18n.js        ← Translation strings
```

### Tech Stack

- **Backend:** Node.js + Express + Socket.IO
- **Video:** WebRTC (browser-native)
- **Virtual BG:** MediaPipe Selfie Segmentation
- **Fonts:** Vazirmatn (FA) + Inter (EN)
- **No native binaries** — works on any Node.js hosting

---
## 🇮🇷 فارسی

### معرفی

**موله** یک سیستم تماس ویدیویی گروهی متن‌باز است که روی Node.js اجرا می‌شود.  
بدون نیاز به ثبت‌نام، بدون نصب اپلیکیشن، با رمزنگاری end-to-end.

### امکانات

| امکان | توضیح |
|-------|-------|
| 🎥 **ویدیو و صدای HD** | کدک VP9/H264 + Opus، ارتباط P2P |
| 🔒 **رمزنگاری E2E** | WebRTC DTLS/SRTP — سرور محتوا نمی‌بیند |
| 🖥️ **اشتراک صفحه** | با صدای سیستم |
| 🎨 **پس‌زمینه مجازی AI** | MediaPipe Selfie Segmentation — در مرورگر |
| 📺 **پخش زنده YouTube** | با Stream Key یوتیوب |
| ⏺️ **ضبط جلسه** | WebM با میکس صدای همه |
| 👑 **کنترل مدیر** | تأیید ورود، سکوت، اخراج |
| ⧉ **Picture in Picture** | ویدیو در پنجره شناور |
| 🌐/🔒 **اتاق عمومی/خصوصی** | بدون تأیید یا با تأیید مدیر |
| 🌍 **دو زبانه** | فارسی و انگلیسی |
| 📱 **Responsive** | موبایل، تبلت، دسکتاپ |

### نصب روی Hostinger

#### پیش‌نیازها
- Node.js 18+ 
- پورت‌های باز: `3000/tcp` (یا 443)

#### نصب سریع

```bash
# 1. دانلود پروژه
git clone https://github.com/6arshid/Hostinger-WebRTC-live-video-chat.git
cd Hostinger-WebRTC-live-video-chat

# 2. نصب وابستگی‌ها (فقط express + socket.io — بدون native binary)
npm install

# 3. اجرا
npm start
```

#### نصب روی Hostinger Node.js Hosting

```
hPanel → Node.js:
  Entry file: server.js
  Node version: 18+
  → Install Dependencies → Start
```

#### متغیرهای محیطی (اختیاری)

```bash
PORT=3000                          # پورت سرور
SSL_CERT=/path/to/fullchain.pem    # مسیر SSL
SSL_KEY=/path/to/privkey.pem       # کلید SSL
NODE_ENV=production                # حالت production
ALLOWED_ORIGIN=https://yourdomain.com  # CORS origin
```

### پخش زنده YouTube

#### روش ۱: مستقیم از مرورگر (دکمه Live)
1. وارد اتاق شوید
2. دکمه **📺 Live** را بزنید
3. **Stream Key** از YouTube Studio را وارد کنید:
   - `YouTube Studio` → `Go Live` → `Stream` → Copy stream key
4. دکمه **▶ شروع پخش** را بزنید

> **توجه:** مرورگر نمی‌تواند مستقیماً RTMP ارسال کند.  
> برای پخش واقعی، از روش ۲ (ffmpeg) استفاده کنید.

#### روش ۲: ffmpeg (پیشنهادی برای کیفیت بالا)

```bash
# روی سرور یا محلی:
ffmpeg -f avfoundation -i "default" \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -c:a aac -b:a 128k \
  -f flv rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY
```

#### روش ۳: OBS Studio (آسان‌ترین)
1. OBS را باز کنید
2. `Settings` → `Stream` → `YouTube RTMPS`
3. Stream Key را وارد کنید
4. `Add Source` → `Browser` → آدرس موله را وارد کنید

### امنیت

- ✅ Content Security Policy (CSP)
- ✅ X-Frame-Options: DENY
- ✅ X-XSS-Protection
- ✅ Rate Limiting (IP-based)
- ✅ Input Sanitization
- ✅ Slug Validation (regex)
- ✅ Signal relay فقط بین peers همان اتاق
- ✅ Max payload 64KB
- ✅ Auto room cleanup پس از ۱۰ دقیقه

### ساختار فایل‌ها

```
mulle/
├── server.js          ← سرور signaling (امن، rate-limited)
├── package.json       ← فقط express + socket.io
└── public/
    ├── index.html     ← UI دو زبانه (FA/EN)
    ├── client.js      ← WebRTC + YouTube Live + Virtual BG
    └── i18n.js        ← ترجمه‌ها
```

---


## License

MIT © [6arshid](https://github.com/6arshid/)

---

<div align="center">

Made with ❤️ by [6arshid](https://github.com/6arshid/) | [GitHub Profile](https://github.com/6arshid/)

⭐ **Star this repo** if you find it useful!

</div>
