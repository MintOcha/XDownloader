(() => {
    const fetch = window.fetch
    const { open, send } = XMLHttpRequest.prototype
    const graphql = input => {
        const url = URL.parse(typeof input === 'string' ? input : input?.url ?? input?.href ?? '', location.href)
        return url?.origin === location.origin && url.pathname.startsWith('/i/api/graphql/')
    }

    function readResponse(response) {
        const root = response?.data
        if (!root || typeof root !== 'object') return
        const posts = []
        const stack = [root]
        while (stack.length) {
            const node = stack.pop()
            if (node?.legacy?.id_str && (node.__typename === 'Tweet' || node.legacy.extended_entities)) {
                const unwrap = result => result?.tweet ?? result
                const quote = unwrap(node.quoted_status_result?.result)
                const repost = unwrap(node.legacy.retweeted_status_result?.result ?? node.retweeted_status_result?.result)
                const media = node.legacy.extended_entities?.media ?? node.legacy.entities?.media ?? []
                const related = [quote?.legacy?.id_str, repost?.legacy?.id_str].filter(Boolean)
                if (media.length || related.length) {
                    posts.push({
                        id: node.legacy.id_str,
                        owner: node.core?.user_results?.result?.core?.screen_name,
                        related,
                        media: media.map(item => ({
                            id: item.id_str ?? item.media_key,
                            kind: item.type,
                            preview: item.media_url_https,
                            variants: item.video_info?.variants?.filter(variant => variant.content_type === 'video/mp4')
                                .map(({ url, bitrate }) => ({ url, bitrate })),
                        })),
                    })
                }
                if (quote) stack.push(quote)
                if (repost) stack.push(repost)
                continue
            }
            for (const child of Object.values(node)) {
                if (child && typeof child === 'object') stack.push(child)
            }
        }
        if (posts.length) window.postMessage({ type: 'xdownloader:media', posts }, location.origin)
    }

    function capture(text) {
        try { if (text.trim()) readResponse(JSON.parse(text)) }
        catch (error) { console.debug('XDownloader: could not read media metadata', error.name) }
    }

    window.fetch = async function (input, ...args) {
        const response = await fetch.call(this, input, ...args)
        if (response.ok && graphql(input)) response.clone().text().then(capture, () => {})
        return response
    }

    const observed = new WeakSet()
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        const result = open.call(this, method, url, ...args)
        if (graphql(url)) observed.add(this)
        else observed.delete(this)
        return result
    }
    XMLHttpRequest.prototype.send = function (...args) {
        if (observed.has(this)) this.addEventListener('loadend', function () {
            if (this.status < 200 || this.status >= 300) return
            if (this.responseType === 'json') {
                try { readResponse(this.response) }
                catch (error) { console.debug('XDownloader: could not read media metadata', error.name) }
            } else if (!this.responseType || this.responseType === 'text') capture(this.responseText)
        }, { once: true })
        return send.apply(this, args)
    }
})()
