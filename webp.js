async function encodeWebpAnimation(video) {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    const interval = 1000 / 15
    const rate = 3
    const listeners = new AbortController()
    try {
        const failed = new Promise((_, reject) => {
            video.addEventListener('error', () => reject(new Error('Could not decode animation')), { signal: listeners.signal })
        })
        const capture = async () => {
            if (video.error) throw new Error('Could not decode animation')
            if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
                video.preload = 'auto'
                await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true, signal: listeners.signal }))
            }
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const parts = []
            video.playbackRate = rate
            let frame = Promise.all([captureFrame(), video.play()]).then(([image]) => image)
            let start = 0
            let size = 0
            while (true) {
                const image = await frame
                if (listeners.signal.aborted) throw new Error('Animation capture stopped')
                const wait = (start + interval - video.currentTime * 1000) / rate
                if (!video.ended && wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
                if (listeners.signal.aborted) throw new Error('Animation capture stopped')
                const end = video.ended ? Math.round(video.duration * 1000) : Math.round(video.currentTime * 1000)
                if (end <= start && !video.ended) continue
                const header = webpHeader(24, 'ANMF', 16 + image.size)
                setWebpUint24(header, 14, canvas.width - 1)
                setWebpUint24(header, 17, canvas.height - 1)
                setWebpUint24(header, 20, Math.max(1, end - start))
                header.setUint8(23, 2) // Full opaque frames replace the canvas.
                parts.push(header.buffer, image)
                size += header.byteLength + image.size
                if (video.ended) break
                start = end
                frame = captureFrame()
            }
            const riff = webpHeader(12, 'RIFF', 36 + size)
            riff.setUint32(8, 0x50424557, true) // WEBP
            const extended = webpHeader(18, 'VP8X', 10)
            extended.setUint8(8, 2) // Animation flag.
            setWebpUint24(extended, 12, canvas.width - 1)
            setWebpUint24(extended, 15, canvas.height - 1)
            const animation = webpHeader(14, 'ANIM', 6) // Zero loop count means repeat forever.
            return new Blob([riff.buffer, extended.buffer, animation.buffer, ...parts], { type: 'image/webp' })
        }
        function captureFrame() {
            context.drawImage(video, 0, 0)
            return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.75)).then(webpFrame)
        }
        return await Promise.race([capture(), failed])
    } finally {
        listeners.abort()
    }
}

function webpHeader(length, tag, size) {
    const view = new DataView(new ArrayBuffer(length))
    for (let i = 0; i < 4; i++) view.setUint8(i, tag.charCodeAt(i))
    view.setUint32(4, size, true)
    return view
}

function setWebpUint24(view, offset, value) {
    view.setUint16(offset, value, true)
    view.setUint8(offset + 2, value >>> 16)
}

async function webpFrame(image) {
    if (image?.type !== 'image/webp') throw new Error('Firefox could not encode a WebP frame')
    // Keep only the compressed frame chunk, including its RIFF padding.
    for (let offset = 12; offset + 8 <= image.size;) {
        const header = new DataView(await image.slice(offset, offset + 8).arrayBuffer())
        const tag = header.getUint32(0, true)
        const length = header.getUint32(4, true)
        const end = offset + 8 + length + (length % 2)
        if (end > image.size) break
        if (tag === 0x20385056 || tag === 0x4c385056) return image.slice(offset, end) // VP8 or VP8L
        offset = end
    }
    throw new Error('Firefox returned no WebP frame')
}
