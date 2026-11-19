# XDownloader

Firefox extension to download photos, videos, and GIFs from X (formerly Twitter).

## Features

- Download photos, videos, and GIFs from `x.com` and `twitter.com`
- Configurable video quality (`Best available`, `Balanced`, `Smallest file`)
- Download individual photos from profile tiles or the full-size viewer.
- Pick individual attachments or download them all. The picker uses two columns from four attachments onward. Click or tap outside, press Escape, or move the mouse out of the button and picker area to close it.
- GIFs and silent videos up to five seconds save as WebP by default. Both settings are configurable.
- Filenames include the author and post ID by default. Optional Save As prompt and view count hiding.

## Installation (Local / Unpacked)

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select `manifest.json` from this repository.

> Requires Firefox 140.0 or newer (`strict_min_version: 140.0`).

## License

[MIT](LICENSE)
