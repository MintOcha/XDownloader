(() => {
    const defaults = {
        quality: 'best', animationFormat: 'webp',
        shortSilentVideosAsWebp: true,
        shortWebpMaxSeconds: 5,
        spcificPathName: false, readableName: true, hideViewCount: false,
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
        const photo = /^\/(\w+)\/status\/(\d+)\/photo\/([1-9]\d*)\/?$/
        const profileGallery = /^\/\w+\/(?:media|photos)\/?$/
        const article = 'article[data-testid="tweet"]'
        const viewer = '[role="dialog"], [aria-modal="true"], [aria-label="Media Viewer"]'
        const tile = '[role="listitem"]'
        const identifiedTile = `${tile}[id*="-profile-photo-grid-"]`
        const tilesOnPage = () => profileGallery.test(location.pathname) ? tile : identifiedTile
        const photoLink = 'a[href*="/status/"][href*="/photo/"]'
        const photoImage = 'img[src*="pbs.twimg.com/media/"]'
        const media = `${photoImage}, video, [data-testid="videoPlayer"]`
        const shareIcon = '[data-testid="share"] svg, svg:has(path[d^="M12 2.59l5.7 5.7"])'
        const viewerToolbar = `[role="group"]:has([data-testid="reply"]):not(${article} *, :is(${viewer}) *)`
        const surface = `${article}, ${viewer}, ${viewerToolbar}`
        const downloadPath = 'M12 16l-5.7-5.7 1.41-1.42L11 12.18V2.59h2v9.59l3.3-3.3 1.41 1.42L12 16zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z'
        let picker
        const itemState = (post, id, otherwise = '') =>
            post?.pending.has(id) ? 'pending' : post?.saved.has(id) ? 'complete' : otherwise
        const postState = (post, otherwise = '') => post?.saved.size ? 'complete' : post?.pending.size ? 'pending' : otherwise

        window.addEventListener('message', event => {
            if (event.source !== window || event.origin !== location.origin) return
            if (event.data?.type === 'xdownloader:navigation') return navigated()
            if (event.data?.type !== 'xdownloader:media' || !Array.isArray(event.data.posts)) return
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
            if (!element.matches(article)) return location.pathname.match(status)?.[1]
            for (const link of element.querySelectorAll('a[href*="/status/"]')) {
                if (link.closest(article) !== element || !link.querySelector('time')) continue
                const match = link.pathname.match(status)
                if (match) return match[1]
            }
            return null
        }

        const dirty = new Set()
        let frame = 0
        let path = location.pathname
        function schedule() {
            if (!frame && dirty.size) frame = requestAnimationFrame(() => {
                frame = 0
                for (const element of dirty) if (element.isConnected) install(element)
                dirty.clear()
            })
        }

        function rescan() {
            for (const element of document.querySelectorAll(`${surface}, ${tilesOnPage()}, ${tile}:has(> .xd-photo-download)`)) dirty.add(element)
            schedule()
        }

        function navigated() {
            const next = location.pathname
            if (next === path) return
            const changedMediaView = [path, next].some(path => photo.test(path) || profileGallery.test(path))
            path = next
            if (changedMediaView) rescan()
        }

        function add(node, tiles) {
            if (node.nodeType !== Node.ELEMENT_NODE || node.closest('.xd-download, .xd-picker')) return
            const parent = node.closest(surface)
            if (parent) dirty.add(parent)
            const modal = node.closest(viewer)
            if (modal) dirty.add(modal)
            const photoTile = node.closest(tiles)
            if (photoTile) dirty.add(photoTile)
            for (const element of node.querySelectorAll(`${surface}, ${tiles}`)) dirty.add(element)
        }
        function start() {
            rescan()
            addEventListener('popstate', navigated)
            new MutationObserver(records => {
                const tiles = tilesOnPage()
                for (const record of records) {
                    if (record.type === 'attributes') {
                        if (record.attributeName !== 'href' || record.target.closest(tiles)) add(record.target, tiles)
                    } else {
                        for (const node of record.addedNodes) add(node, tiles)
                        const changedTile = record.removedNodes.length && record.target.closest(tiles)
                        if (changedTile) dirty.add(changedTile)
                    }
                }
                schedule()
            }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'poster', 'href'] })
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
        else start()

        function viewedPhoto(id) {
            const match = location.pathname.match(photo)
            if (match?.[2] === id) return match
        }

        function install(element) {
            if (!element.matches(surface)) return installTile(element)
            const id = postOn(element)
            const toolbar = element.matches(viewerToolbar)
            const viewed = viewedPhoto(id)
            if (!viewed) element.querySelector(':scope > .xd-viewer-download')?.remove()
            if (toolbar && !viewed) return element.querySelector(':scope > .xd-download')?.remove()
            if (!id) return
            const owns = node => node.closest(surface) === element
            const share = [...element.querySelectorAll(shareIcon)].find(owns)
            if (toolbar && !share) return
            const group = toolbar ? element : share?.closest('[role="group"]')
                ?? [...element.querySelectorAll('[role="group"]')].findLast(owns)
            if (!group && (!viewed || element.matches(article) || element.querySelector(viewer))) return
            let button = group?.querySelector(':scope > .xd-download') ?? element.querySelector(':scope > .xd-viewer-download')
            if (!button) {
                if (!(!element.matches(article) && viewed && share) && !element.querySelector(media)) return
                button = downloadButton(element, share)
                const shareButton = group && share?.closest('button')
                if (shareButton) {
                    button.classList.add('xd-toolbar-action')
                    button.style.minInlineSize = `${shareButton.offsetWidth}px`
                    button.style.minBlockSize = `${shareButton.offsetHeight}px`
                }
                if (!group) button.classList.add('xd-viewer-download')
                ;(group ?? element).append(button)
            }
            const item = viewed && photoAt(posts.get(id), Number(viewed[3]))
            if (!viewed || item || button.dataset.post !== id || button.dataset.position !== viewed[3]) {
                bind(button, id, item?.id, viewed?.[3])
            }
        }

        function activate(button, element, event) {
            const isTile = !element.matches(surface)
            const id = isTile ? undefined : postOn(element)
            const selected = isTile ? tilePhoto(element) : null
            const match = isTile ? selected?.match : viewedPhoto(id)
            if (!match) {
                if (element.matches(viewerToolbar)) return
                if (id) choose(button, id, event.pointerType === 'mouse')
                else if (isTile) paint(button, 'unavailable', 'Download photo')
                return
            }
            const post = getPost(match[2])
            const item = selected?.item ?? photoAt(post, Number(match[3]))
                ?? photoFrom(match, visiblePhoto(element.closest(viewer) ?? document))
            if (!item) return paint(button, 'unavailable', 'Download photo')
            bind(button, post.id, item.id, match[3])
            save(post, item)
        }

        function downloadButton(element, share) {
            const button = document.createElement('button')
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
                activate(button, element, event)
            })
            return button
        }

        function photoAt(post, position) {
            if (!post) return
            for (const item of post.items.values()) if (item.kind === 'photo' && item.position === position) return item
        }

        function tilePhoto(element) {
            if (!element.matches(tilesOnPage()) || element.closest(surface)) return
            const link = element.querySelector(photoLink)
            const match = link?.origin === location.origin && link.pathname.match(photo)
            const item = match && photoFrom(match, link.querySelector(photoImage))
            if (item) return { match, item }
        }

        function installTile(element) {
            const selected = tilePhoto(element)
            let button = element.querySelector(':scope > .xd-download')
            if (!selected) return button?.remove()
            if (!button) {
                button = downloadButton(element)
                button.classList.add('xd-photo-download')
                if (getComputedStyle(element).position === 'static') element.classList.add('xd-photo-tile')
                element.append(button)
            }
            const { match, item } = selected
            bind(button, match[2], item.id, match[3])
        }

        function photoFrom(match, image) {
            if (!image) return null
            const [, author, id, index] = match
            const position = Number(index)
            const item = normalize({ kind: 'photo', preview: image.currentSrc || image.src }, id, author, position)
            if (!item) return null
            return posts.get(id)?.items.get(item.id) ?? item
        }

        function visiblePhoto(element) {
            // X renders neighboring slides too; use the photo occupying the most viewport space.
            const slides = '[aria-label="Media Viewer"] .h-full.w-full.shrink-0, [data-testid="swipe-to-dismiss"]'
            let visible, largest = 0
            for (const image of element.querySelectorAll(photoImage)) {
                if (!image.closest(slides) || image.closest(`${article}, [aria-hidden="true"]`)) continue
                const { left, right, top, bottom } = image.getBoundingClientRect()
                const area = Math.max(0, Math.min(innerWidth, right) - Math.max(0, left))
                    * Math.max(0, Math.min(innerHeight, bottom) - Math.max(0, top))
                if (area > largest) {
                    largest = area
                    visible = image
                }
            }
            return visible
        }

        function bind(button, id, item, position) {
            const post = posts.get(id)
            button.dataset.post = id
            if (position) {
                button.dataset.photo = item ?? ''
                button.dataset.position = position
                paint(button, itemState(post, item), 'Download photo')
            } else {
                delete button.dataset.photo
                delete button.dataset.position
                paint(button, postState(post))
            }
        }

        function render(post, id, failure = false) {
            const fallback = failure ? 'failed' : ''
            const photoState = itemState(post, id, fallback)
            const state = postState(post, fallback)
            for (const button of document.querySelectorAll(`.xd-download[data-post="${post.id}"]`)) {
                if (button.dataset.photo === undefined) paint(button, state)
                else if (button.dataset.photo === id) paint(button, photoState, 'Download photo')
            }
            if (picker?.post === post) updateRow(picker.rows.get(id), photoState)
        }

        function choose(button, id, dismissOnLeave) {
            const post = getPost(id)
            const items = new Map(post.items)
            for (const relatedId of post.related) {
                for (const [key, item] of posts.get(relatedId)?.items ?? []) if (!items.has(key)) items.set(key, item)
            }
            if (!items.size) paint(button, 'unavailable')
            else if (items.size === 1) save(post, items.values().next().value)
            else openPicker(button, post, [...items.values()], dismissOnLeave)
        }

        function openPicker(button, post, items, dismissOnLeave) {
            if (picker) {
                const previous = picker
                previous.dialog.hidePopover()
                if (previous.button === button) return
            }
            const dialog = document.createElement('div')
            dialog.id = 'xd-media-picker'
            dialog.popover = 'auto'
            dialog.setAttribute('role', 'dialog')
            dialog.className = 'xd-picker'
            if (items.length >= 4) dialog.classList.add('xd-picker-grid')
            dialog.setAttribute('aria-label', 'Choose media to download')
            const all = document.createElement('button')
            all.type = 'button'
            all.className = 'xd-choice xd-choice-all'
            all.textContent = 'All'
            all.setAttribute('aria-label', 'Download all attachments')
            all.addEventListener('click', () => {
                for (const item of items) save(post, item)
            })
            dialog.append(all)
            const rows = new Map()
            picker = { dialog, button, post, rows }
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
                const row = { option, label }
                rows.set(item.id, row)
                updateRow(row, itemState(post, item.id))
                dialog.append(option)
            }
            let grace
            const position = () => {
                if (!button.isConnected) return dialog.hidePopover()
                const anchor = button.getBoundingClientRect()
                const { width, height } = dialog.getBoundingClientRect()
                const gap = 8
                const preferredTop = anchor.bottom + gap + height <= innerHeight ? anchor.bottom + gap : anchor.top - height - gap
                const top = Math.max(gap, Math.min(preferredTop, innerHeight - height - gap))
                const left = Math.max(gap, Math.min(anchor.right - width, innerWidth - width - gap))
                dialog.style.top = `${top}px`
                dialog.style.left = `${left}px`
                if (dismissOnLeave) grace = {
                    left: Math.min(anchor.left, left), right: Math.max(anchor.right, left + width),
                    top: Math.min(anchor.top, top), bottom: Math.max(anchor.bottom, top + height),
                }
            }
            const listeners = new AbortController()
            dialog.addEventListener('beforetoggle', event => {
                if (event.newState !== 'closed') return
                listeners.abort()
                button.removeAttribute('aria-controls')
                button.removeAttribute('aria-expanded')
                if (picker?.dialog === dialog) picker = null
                queueMicrotask(() => dialog.remove())
            })
            ;(document.fullscreenElement ?? document.body).append(dialog)
            button.setAttribute('aria-controls', dialog.id)
            button.setAttribute('aria-expanded', 'true')
            dialog.showPopover({ source: button })
            position()
            const options = { capture: true, signal: listeners.signal }
            addEventListener('resize', position, options)
            addEventListener('scroll', position, options)
            if (dismissOnLeave) {
                addEventListener('pointermove', event => {
                    if (event.pointerType !== 'mouse' || !grace) return
                    const { clientX: x, clientY: y } = event
                    const { left, right, top, bottom } = grace
                    if (x < left || x > right || y < top || y > bottom) dialog.hidePopover()
                }, options)
                addEventListener('pointerout', event => {
                    if (event.pointerType === 'mouse' && !event.relatedTarget) dialog.hidePopover()
                }, options)
            }
            all.focus({ preventScroll: true })
        }

        function updateRow(row, state) {
            if (!row) return
            row.option.disabled = state === 'pending'
            row.label.textContent = { pending: 'Saving…', failed: 'Not saved · Retry', complete: 'Saved' }[state] ?? ''
        }

        async function save(post, item) {
            if (post.pending.has(item.id)) return
            post.pending.add(item.id)
            render(post, item.id)
            let saved = false
            try {
                saved = await browser.runtime.sendMessage({ type: 'save-media', item }) === true
                if (saved) post.saved.add(item.id)
            } catch (error) {
                console.warn('XDownloader:', error.message)
            } finally {
                post.pending.delete(item.id)
                render(post, item.id, !saved)
            }
        }
    }

    function paint(button, state, action = 'Download media') {
        button.dataset.state = state
        button.title = { complete: 'Media saved', pending: 'Saving media…', failed: 'Download failed — retry',
            unavailable: 'Media not available — reload the post', '': action }[state]
        button.setAttribute('aria-label', button.title)
    }

    function normalize(item, postId, owner, position, count = 1) {
        if (!item || !Object.hasOwn(mediaHost, item.kind)) return null
        const preview = cdn(item.preview, 'pbs.twimg.com')
        if (!preview) return null
        const { kind } = item
        let url, id = item.id
        if (kind === 'photo') {
            if (!preview.pathname.startsWith('/media/')) return null
            const original = new URL(preview)
            const match = original.pathname.match(/\.([a-z\d]+)(?=:[a-z]+$|$)/i)
            if (match) {
                original.pathname = original.pathname.slice(0, match.index)
                if (!original.searchParams.has('format')) original.searchParams.set('format', match[1])
            }
            original.pathname = original.pathname.replace(/:[a-z]+$/i, '')
            id = original.pathname
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
        const name = `${author}-${postId}${count > 1 || position > 1 ? `-${position}` : ''}`
        return { id: typeof id === 'string' && id ? id : new URL(best).pathname,
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
