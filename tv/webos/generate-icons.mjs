import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function crc32(buf) {
    let crc = 0xffffffff
    for (const byte of buf) {
        crc ^= byte
        for (let i = 0; i < 8; i += 1) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
        }
    }
    return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
    const typeBuf = Buffer.from(type)
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
    return Buffer.concat([len, typeBuf, data, crc])
}

function png(width, height, paint) {
    const raw = Buffer.alloc((width * 4 + 1) * height)
    for (let y = 0; y < height; y += 1) {
        const row = y * (width * 4 + 1)
        raw[row] = 0
        for (let x = 0; x < width; x += 1) {
            const i = row + 1 + x * 4
            const pixel = paint(x, y)
            raw[i] = pixel[0]
            raw[i + 1] = pixel[1]
            raw[i + 2] = pixel[2]
            raw[i + 3] = pixel[3]
        }
    }

    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = 6

    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

function inRoundedBox(x, y, left, top, size, radius) {
    if (x < left || x >= left + size || y < top || y >= top + size) return false
    const r = radius
    if (x < left + r && y < top + r) {
        const dx = (left + r) - x - 0.5
        const dy = (top + r) - y - 0.5
        return (dx * dx + dy * dy) <= (r * r)
    }
    if (x >= left + size - r && y < top + r) {
        const dx = x - (left + size - r) + 0.5
        const dy = (top + r) - y - 0.5
        return (dx * dx + dy * dy) <= (r * r)
    }
    if (x < left + r && y >= top + size - r) {
        const dx = (left + r) - x - 0.5
        const dy = y - (top + size - r) + 0.5
        return (dx * dx + dy * dy) <= (r * r)
    }
    if (x >= left + size - r && y >= top + size - r) {
        const dx = x - (left + size - r) + 0.5
        const dy = y - (top + size - r) + 0.5
        return (dx * dx + dy * dy) <= (r * r)
    }
    return true
}

function inH(x, y, left, top, size) {
    const padX = size * 0.28
    const padY = size * 0.25
    const bar = Math.max(2, Math.round(size * 0.14))
    const lx = left + padX
    const rx = left + size - padX - bar
    const midY = top + size / 2 - bar / 2
    const inLeft = x >= lx && x < lx + bar && y >= top + padY && y < top + size - padY
    const inRight = x >= rx && x < rx + bar && y >= top + padY && y < top + size - padY
    const inCross = x >= lx && x < rx + bar && y >= midY && y < midY + bar
    return inLeft || inRight || inCross
}

function markPaint(size) {
    const inset = Math.floor(size * 0.12)
    const box = size - inset * 2
    const radius = Math.round(box * 0.22)
    return function paint(x, y) {
        if (inRoundedBox(x, y, inset, inset, box, radius)) {
            return inH(x, y, inset, inset, box) ? [17, 17, 17, 255] : [255, 255, 255, 255]
        }
        return [0, 0, 0, 255]
    }
}

function splashPaint(x, y) {
    // Esattamente identico a #splash i di index.html: 72x72 con border-radius 16px, centrato
    const box = 72
    const radius = 16
    const left = Math.round((1920 - box) / 2)
    const top = Math.round((1080 - box) / 2)
    if (inRoundedBox(x, y, left, top, box, radius)) {
        return inH(x, y, left, top, box) ? [17, 17, 17, 255] : [255, 255, 255, 255]
    }
    return [0, 0, 0, 255]
}

writeFileSync(join(dir, 'icon.png'), png(80, 80, markPaint(80)))
writeFileSync(join(dir, 'largeIcon.png'), png(130, 130, markPaint(130)))
writeFileSync(join(dir, 'splashBackground.png'), png(1920, 1080, splashPaint))
console.log('Icone e splash webOS generati con successo (72x72 con angoli stondati 16px, centrati al pixel)')
