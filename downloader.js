(() => {
    const defaults = {
        quality: 'best', animationFormat: 'mp4',
        shortSilentVideosAsWebp: false,
        shortWebpMaxSeconds: 10,
        spcificPathName: false, readableName: false, hideViewCount: false,
    }
    const mediaHost = { photo: 'pbs.twimg.com', video: 'video.twimg.com', animated_gif: 'video.twimg.com' }
    const idPattern = /^\d+$/
    const cdn = (value, host) => {
        if (typeof value !== 'string') return null
        const url = URL.parse(value)
        return url?.origin === `https://${host}` && !url.username && !url.password ? url : null
    }

    if (location.protocol !== 'moz-extension:') startTimeline()
    else if (document.body?.classList.contains('xd-settings')) startSettings()
    else startDownloads()

    async function startSettings() {
        const form = document.querySelector('form')
        form.addEventListener('submit', event => event.preventDefault())
        const settings = await browser.storage.sync.get(defaults)
        for (const [name, value] of Object.entries(settings)) {
            const input = form.elements[name]
            if (input.type === 'checkbox') input.checked = value
            else {
                input.value = value
                if (!input.value) input.value = defaults[name]
            }
        }
        const enabled = form.elements.shortSilentVideosAsWebp
        const duration = form.elements.shortWebpMaxSeconds
        const durationValue = form.querySelector('#xd-duration-value')
        function showDuration() {
            duration.disabled = !enabled.checked
            durationValue.textContent = `${duration.value} s`
            duration.setAttribute('aria-valuetext', `${duration.value} seconds`)
        }
        showDuration()
        duration.addEventListener('input', showDuration)
        form.addEventListener('change', async ({ target }) => {
            if (target === enabled) showDuration()
            const output = form.querySelector('output')
            try {
                const value = target === duration ? duration.valueAsNumber : target.type === 'checkbox' ? target.checked : target.value
                await browser.storage.sync.set({ [target.name]: value })
                output.textContent = 'Settings saved'
            } catch {
                output.textContent = 'Settings could not be saved'
            }
        })
    }

    function startTimeline() {
        const posts = new Map()
        const status = /\/status\/(\d+)(?:\/|$)/
        const article = 'article[data-testid="tweet"]'
        const viewer = '[role="dialog"], [aria-modal="true"]'
        const surface = `${article}, ${viewer}`
        const media = 'img[src*="pbs.twimg.com/media/"], video, [data-testid="videoPlayer"]'
        const shareIcon = '[data-testid="share"] svg, svg:has(path[d^="M12 2.59l5.7 5.7"])'
        const downloadPath = 'M12 16l-5.7-5.7 1.41-1.42L11 12.18V2.59h2v9.59l3.3-3.3 1.41 1.42L12 16zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z'
        let picker

        window.addEventListener('message', event => {
            if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'xdownloader:media') return
            if (!Array.isArray(event.data.posts)) return
            for (const record of event.data.posts) {
                if (typeof record?.id !== 'string' || !idPattern.test(record.id) || !Array.isArray(record.media)) continue
                const post = getPost(record.id)
                if (Array.isArray(record.related)) {
                    for (const id of record.related) if (typeof id === 'string' && idPattern.test(id)) post.related.add(id)
                }
                for (const [position, item] of record.media.entries()) {
                    const entry = normalize(item, record.id, record.owner, position + 1, record.media.length)
                    if (entry) post.items.set(entry.id, entry)
                }
            }
        })

        const hideViews = enabled => document.documentElement?.classList.toggle('xd-hide-views', enabled === true)
        browser.storage.sync.get({ hideViewCount: defaults.hideViewCount }).then(settings => hideViews(settings.hideViewCount))
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.hideViewCount) {
                hideViews(changes.hideViewCount.newValue)
            }
        })

        function getPost(id) {
            if (!posts.has(id)) posts.set(id, { id, items: new Map(), related: new Set(), pending: new Set(), saved: new Set() })
            return posts.get(id)
        }

        function postOn(element) {
            if (!element.matches(article)) return location.pathname.match(status)
            for (const link of element.querySelectorAll('a[href*="/status/"]')) {
                if (link.closest(article) !== element || !link.querySelector('time')) continue
                const match = link.pathname.match(status)
                if (match) return match
            }
            return null
        }

        const dirty = new Set()
        let frame = 0
        function add(node) {
            if (node.nodeType !== Node.ELEMENT_NODE || node.closest('.xd-download, .xd-picker')) return
            const parent = node.closest(surface)
            if (parent) dirty.add(parent)
            for (const element of node.querySelectorAll(surface)) dirty.add(element)
        }
        function start() {
            document.querySelectorAll(surface).forEach(install)
            new MutationObserver(records => {
                for (const record of records) {
                    if (record.type === 'attributes') add(record.target)
                    else for (const node of record.addedNodes) add(node)
                }
                if (dirty.size && !frame) frame = requestAnimationFrame(() => {
                    frame = 0
                    for (const element of dirty) if (element.isConnected) install(element)
                    dirty.clear()
                })
            }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'poster'] })
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
        else start()

        function install(element) {
            const match = postOn(element)
            if (!match) return
            const share = [...element.querySelectorAll(shareIcon)].find(icon => icon.closest(surface) === element)
            const group = share?.closest('[role="group"]') ??
                [...element.querySelectorAll('[role="group"]')].findLast(candidate => candidate.closest(surface) === element)
            if (!group) return
            let button = group.querySelector(':scope > .xd-download')
            if (!button) {
                if (!element.querySelector(media)) return
                button = document.createElement('button')
                button.type = 'button'
                button.className = 'xd-download'
                const svg = share?.cloneNode(false) ?? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
                svg.setAttribute('viewBox', '0 0 24 24')
                svg.setAttribute('aria-hidden', 'true')
                if (share) {
                    const style = getComputedStyle(share)
                    button.style.setProperty('--xd-icon-color', style.color)
                    svg.style.fontSize = style.fontSize
                } else svg.classList.add('xd-fallback-icon')
                const path = document.createElementNS(svg.namespaceURI, 'path')
                path.setAttribute('d', downloadPath)
                path.setAttribute('fill', 'currentColor')
                svg.append(path)
                button.append(svg)
                button.addEventListener('click', event => {
                    event.stopPropagation()
                    event.preventDefault()
                    const selected = postOn(element)
                    if (selected) choose(button, selected[1])
                })
                group.append(button)
            }
            button.dataset.post = match[1]
            const post = posts.get(match[1])
            paint(button, post?.saved.size ? 'complete' : post?.pending.size ? 'pending' : '')
        }

        function render(post, failure = false) {
            const state = post.saved.size ? 'complete' : post.pending.size ? 'pending' : failure ? 'failed' : ''
            for (const button of document.querySelectorAll(`.xd-download[data-post="${post.id}"]`)) paint(button, state)
        }

        function choose(button, id) {
            const post = getPost(id)
            const items = new Map(post.items)
            for (const relatedId of post.related) {
                for (const [key, item] of posts.get(relatedId)?.items ?? []) if (!items.has(key)) items.set(key, item)
            }
            const choices = [...items.values()]
            if (!choices.length) paint(button, 'unavailable')
            else if (choices.length > 1) openPicker(button, post, choices)
            else save(post, choices[0])
        }

        function openPicker(button, post, items) {
            if (picker?.matches(':popover-open')) {
                const sameButton = picker.id === button.getAttribute('aria-controls')
                picker.hidePopover()
                if (sameButton) return
            }
            const dialog = document.createElement('div')
            picker = dialog
            dialog.id = 'xd-media-picker'
            dialog.popover = 'auto'
            dialog.setAttribute('role', 'dialog')
            dialog.className = 'xd-picker'
            dialog.setAttribute('aria-label', 'Choose media to download')
            const all = document.createElement('button')
            all.type = 'button'
            all.className = 'xd-choice'
            all.textContent = 'All'
            all.setAttribute('aria-label', 'Download all attachments')
            all.addEventListener('click', () => {
                for (const item of items) save(post, item)
            })
            dialog.append(all)
            const rows = new Map()
            post.rows = rows
            for (const [index, item] of items.entries()) {
                const option = document.createElement('button')
                option.className = 'xd-choice'
                option.type = 'button'
                const preview = document.createElement('img')
                preview.src = item.preview
                preview.alt = ''
                const title = document.createElement('span')
                title.textContent = `${{ photo: 'Photo', video: 'Video', animated_gif: 'GIF' }[item.kind]} ${index + 1}`
                const label = document.createElement('small')
                label.setAttribute('aria-live', 'polite')
                option.append(preview, title, label)
                option.addEventListener('click', () => save(post, item))
                rows.set(item.id, { option, label })
                updateRow(post, item.id)
                dialog.append(option)
            }
            const position = () => {
                if (!button.isConnected) return dialog.hidePopover()
                const anchor = button.getBoundingClientRect()
                const { width, height } = dialog.getBoundingClientRect()
                const gap = 8
                const top = anchor.bottom + gap + height <= innerHeight ? anchor.bottom + gap : anchor.top - height - gap
                dialog.style.top = `${Math.max(gap, Math.min(top, innerHeight - height - gap))}px`
                dialog.style.left = `${Math.max(gap, Math.min(anchor.right - width, innerWidth - width - gap))}px`
            }
            const listeners = new AbortController()
            dialog.addEventListener('beforetoggle', event => {
                if (event.newState !== 'closed') return
                listeners.abort()
                button.removeAttribute('aria-controls')
                button.removeAttribute('aria-expanded')
                if (post.rows === rows) post.rows = null
                if (picker === dialog) picker = null
                queueMicrotask(() => dialog.remove())
            })
            ;(document.fullscreenElement ?? document.body).append(dialog)
            button.setAttribute('aria-controls', dialog.id)
            button.setAttribute('aria-expanded', 'true')
            dialog.showPopover({ source: button })
            position()
            addEventListener('resize', position, { signal: listeners.signal })
            addEventListener('scroll', position, { capture: true, signal: listeners.signal })
            all.focus({ preventScroll: true })
        }

        function updateRow(post, id, failure = false) {
            const row = post.rows?.get(id)
            if (!row) return
            row.option.disabled = post.pending.has(id)
            row.label.textContent = row.option.disabled ? 'Saving…' : failure ? 'Not saved · Retry' : post.saved.has(id) ? 'Saved' : ''
        }

        async function save(post, item) {
            if (post.pending.has(item.id)) return
            post.pending.add(item.id)
            updateRow(post, item.id)
            render(post)
            let saved = false
            try {
                saved = await browser.runtime.sendMessage({ type: 'save-media', item }) === true
                if (saved) post.saved.add(item.id)
            } catch (error) {
                console.warn('XDownloader:', error.message)
            } finally {
                post.pending.delete(item.id)
                updateRow(post, item.id, !saved)
                render(post, !saved)
            }
        }
    }

    function paint(button, state) {
        button.dataset.state = state
        button.title = { complete: 'Media saved', pending: 'Saving media…', failed: 'Download failed — retry',
            unavailable: 'Media not available — reload the post', '': 'Download media' }[state]
        button.setAttribute('aria-label', button.title)
    }

    function normalize(item, postId, owner, position, count) {
        if (!item || !Object.hasOwn(mediaHost, item.kind)) return null
        const preview = cdn(item.preview, 'pbs.twimg.com')
        if (!preview) return null
        const { kind } = item
        let url
        if (kind === 'photo') {
            if (!preview.pathname.startsWith('/media/')) return null
            const original = new URL(preview)
            const match = original.pathname.match(/\.([a-z\d]+)(?=:[a-z]+$|$)/i)
            if (match) {
                original.pathname = original.pathname.slice(0, match.index)
                if (!original.searchParams.has('format')) original.searchParams.set('format', match[1])
            }
            original.searchParams.set('name', 'orig')
            url = original.href
        }
        let best, balanced, smallest
        if (kind !== 'photo' && Array.isArray(item.variants)) {
            const byBitrate = new Map()
            for (const variant of item.variants) {
                const direct = cdn(variant?.url, mediaHost[kind])
                if (!direct || !direct.pathname.endsWith('.mp4')) continue
                const bitrate = Number.isFinite(variant.bitrate) ? variant.bitrate : 0
                if (!byBitrate.has(bitrate)) byBitrate.set(bitrate, direct.href)
            }
            const rates = [...byBitrate.keys()].sort((a, b) => a - b)
            best = byBitrate.get(rates.at(-1))
            balanced = byBitrate.get(rates[Math.floor(rates.length / 2)])
            smallest = byBitrate.get(rates[0])
        }
        if (!url && !best) return null
        preview.searchParams.set('name', 'small')
        const author = typeof owner === 'string' && /^\w+$/.test(owner) ? owner : 'unknown'
        const name = `${author}-${postId}${count > 1 ? `-${position}` : ''}`
        return { id: typeof item.id === 'string' && item.id ? item.id : new URL(url ?? best).pathname,
            kind, position, preview: preview.href, url: url ?? best, balanced, smallest, name }
    }

    function startDownloads() {
        browser.runtime.onMessage.addListener((message, sender) => {
            if (message?.type !== 'save-media' || sender.tab?.id === undefined) return
            return download(message.item)
        })
    }

    async function download(item) {
        if (!item || !Object.hasOwn(mediaHost, item.kind)) return false
        const settings = await browser.storage.sync.get(defaults)
        const variant = settings.quality === 'smallest' ? item.smallest : settings.quality === 'balanced' ? item.balanced : null
        const url = cdn(variant ?? item.url, mediaHost[item.kind])
        if (!url) return false
        const photo = item.kind === 'photo'
        if (photo ? !url.pathname.startsWith('/media/') : !url.pathname.endsWith('.mp4')) return false
        const base = url.pathname.split('/').pop().replace(/:[a-z]+$/i, '')
        const dot = base.lastIndexOf('.')
        const fileStem = dot > 0 ? base.slice(0, dot) : base
        const stem = settings.readableName && /^[\w-]+$/.test(item.name) ? item.name : fileStem
        const format = photo ? url.searchParams.get('format') || (dot > 0 ? base.slice(dot + 1) : 'jpg') : 'mp4'
        if (!/^[\w-]+$/.test(stem) || !/^[a-z\d]+$/i.test(format)) return false
        const save = (source, ext) => saveFile(source, `${stem}.${ext}`, settings.spcificPathName)
        if (item.kind === 'animated_gif' && settings.animationFormat === 'webp') return saveWebp(createVideo(url.href), save)
        if (item.kind === 'video' && settings.shortSilentVideosAsWebp) {
            const video = createVideo(url.href)
            if (await isShortSilentVideo(video, settings.shortWebpMaxSeconds)) return saveWebp(video, save)
            releaseVideo(video)
        }
        return save(url.href, format)
    }

    async function saveFile(url, filename, saveAs) {
        const id = await browser.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' })
        return new Promise((resolve, reject) => {
            function finish(item) {
                if (item?.state === 'in_progress') return
                browser.downloads.onChanged.removeListener(changed)
                if (item?.state === 'complete' && (item.fileSize > 0 || item.fileSize === -1 && item.bytesReceived > 0)) resolve(true)
                else reject(new Error(item?.error || 'Firefox did not save a nonempty file'))
            }
            function check() {
                browser.downloads.search({ id }).then(([item]) => finish(item), error => finish({ error: error.message }))
            }
            function changed(delta) {
                if (delta.id === id && delta.state) check()
            }
            browser.downloads.onChanged.addListener(changed)
            check()
        })
    }

    function createVideo(url) {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.muted = true
        video.crossOrigin = 'anonymous'
        video.src = url
        return video
    }

    function releaseVideo(video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
    }

    function isShortSilentVideo(video, maxSeconds) {
        return new Promise(resolve => {
            const listeners = new AbortController()
            const finish = eligible => {
                clearTimeout(timeout)
                listeners.abort()
                resolve(eligible)
            }
            const timeout = setTimeout(() => finish(false), 5000)
            const check = () => finish(video.duration > 0 && video.duration <= maxSeconds && video.mozHasAudio === false)
            if (video.readyState >= HTMLMediaElement.HAVE_METADATA) check()
            else if (video.error) finish(false)
            else {
                const { signal } = listeners
                video.addEventListener('loadedmetadata', check, { signal })
                video.addEventListener('error', () => finish(false), { signal })
            }
        })
    }

    async function saveWebp(video, save) {
        let blobUrl
        try {
            blobUrl = URL.createObjectURL(await encodeWebpAnimation(video))
            return await save(blobUrl, 'webp')
        } finally {
            releaseVideo(video)
            if (blobUrl) URL.revokeObjectURL(blobUrl)
        }
    }
})()
