#!/usr/bin/env node
/**
 * Convert FBS (VNC recording) to MP4 video
 * Usage: node fbs-to-video.js <input.fbs> [output.mp4]
 * 
 * Requires: ffmpeg installed on system
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// Parse command line args
const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace('.fbs', '.mp4');

if (!inputFile) {
    console.log('Usage: node fbs-to-video.js <input.fbs> [output.mp4]');
    process.exit(1);
}

if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
}

// Check ffmpeg
try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
} catch {
    console.error('ffmpeg not found. Please install ffmpeg first.');
    console.log('  macOS: brew install ffmpeg');
    console.log('  Ubuntu: apt install ffmpeg');
    process.exit(1);
}

console.log(`Converting ${inputFile} to ${outputFile}...`);

// Read FBS file
const data = fs.readFileSync(inputFile);
let offset = 0;

// Parse FBS header
const header = data.toString('utf8', 0, 12);
if (!header.startsWith('FBS 001.')) {
    console.error('Invalid FBS file - bad header');
    console.error('Got:', header);
    console.error('This file was likely recorded with an older version. Please re-record.');
    process.exit(1);
}
offset = 12;

// Parse first block to get dimensions
const firstBlockLen = data.readUInt32BE(offset);
offset += 4;
const firstBlock = data.slice(offset, offset + firstBlockLen);

// Skip to ServerInit in first block
// Format: RFB version (12) + security (4) + width (2) + height (2) + pixel format (16) + name
let blockOffset = 12 + 4; // version + security
const width = firstBlock.readUInt16BE(blockOffset);
const height = firstBlock.readUInt16BE(blockOffset + 2);
blockOffset += 4;

// Read pixel format
const bpp = firstBlock.readUInt8(blockOffset);
const depth = firstBlock.readUInt8(blockOffset + 1);
const bigEndian = firstBlock.readUInt8(blockOffset + 2);
const trueColor = firstBlock.readUInt8(blockOffset + 3);
const redMax = firstBlock.readUInt16BE(blockOffset + 4);
const greenMax = firstBlock.readUInt16BE(blockOffset + 6);
const blueMax = firstBlock.readUInt16BE(blockOffset + 8);
const redShift = firstBlock.readUInt8(blockOffset + 10);
const greenShift = firstBlock.readUInt8(blockOffset + 11);
const blueShift = firstBlock.readUInt8(blockOffset + 12);

console.log(`Resolution: ${width}x${height}`);
console.log(`Pixel format: ${bpp}bpp, depth=${depth}, RGB shifts=${redShift}/${greenShift}/${blueShift}`);

// Initialize framebuffer (RGBA)
const framebuffer = Buffer.alloc(width * height * 4);
framebuffer.fill(0);

// Collect all VNC data from blocks
offset = 12;
const vncData = [];
const timestamps = [];

console.log('Collecting VNC data...');

while (offset < data.length - 8) {
    const blockLen = data.readUInt32BE(offset);
    offset += 4;
    
    if (blockLen === 0 || offset + blockLen > data.length) break;
    
    const paddedLen = (blockLen + 3) & ~3;
    const blockData = data.subarray(offset, offset + blockLen);
    offset += paddedLen;
    
    if (offset + 4 > data.length) break;
    const timestamp = data.readUInt32BE(offset);
    offset += 4;
    
    vncData.push(blockData);
    timestamps.push(timestamp);
}

const allVncData = Buffer.concat(vncData);
console.log(`Total: ${allVncData.length} bytes from ${vncData.length} blocks`);

// Skip FBS init (RFB version + security + ServerInit)
let vncOffset = 0;
if (allVncData.length > 12 && allVncData.toString('utf8', 0, 4) === 'RFB ') {
    vncOffset = 12;
}
if (vncOffset + 4 <= allVncData.length) {
    vncOffset += 4; // security type
}
if (vncOffset + 24 <= allVncData.length) {
    vncOffset += 20; // width + height + pixel format
    const nameLen = allVncData.readUInt32BE(vncOffset);
    vncOffset += 4 + nameLen;
}

// Parse frames into memory
const frames = [];
const pixelBytes = bpp / 8;

console.log('Parsing VNC frames...');

while (vncOffset < allVncData.length) {
    if (vncOffset + 4 > allVncData.length) break;
    
    const msgType = allVncData.readUInt8(vncOffset);
    
    if (msgType === 0) {
        const numRects = allVncData.readUInt16BE(vncOffset + 2);
        vncOffset += 4;
        
        let frameModified = false;
        
        for (let r = 0; r < numRects; r++) {
            if (vncOffset + 12 > allVncData.length) break;
            
            const x = allVncData.readUInt16BE(vncOffset);
            const y = allVncData.readUInt16BE(vncOffset + 2);
            const w = allVncData.readUInt16BE(vncOffset + 4);
            const h = allVncData.readUInt16BE(vncOffset + 6);
            const encoding = allVncData.readInt32BE(vncOffset + 8);
            vncOffset += 12;
            
            if (w === 0 || h === 0 || x + w > width || y + h > height) {
                vncOffset = allVncData.length;
                break;
            }
            
            if (encoding === 0) {
                const rectSize = w * h * pixelBytes;
                if (vncOffset + rectSize > allVncData.length) break;
                
                for (let py = 0; py < h; py++) {
                    for (let px = 0; px < w; px++) {
                        const srcIdx = vncOffset + (py * w + px) * pixelBytes;
                        const dstIdx = ((y + py) * width + (x + px)) * 4;
                        
                        if (dstIdx + 4 <= framebuffer.length) {
                            let pixel = pixelBytes === 4 ? allVncData.readUInt32LE(srcIdx) : allVncData.readUInt16LE(srcIdx);
                            framebuffer[dstIdx] = ((pixel >> redShift) & redMax) * 255 / redMax;
                            framebuffer[dstIdx + 1] = ((pixel >> greenShift) & greenMax) * 255 / greenMax;
                            framebuffer[dstIdx + 2] = ((pixel >> blueShift) & blueMax) * 255 / blueMax;
                            framebuffer[dstIdx + 3] = 255;
                        }
                    }
                }
                vncOffset += rectSize;
                frameModified = true;
                
            } else if (encoding === 1) {
                if (vncOffset + 4 > allVncData.length) break;
                const srcX = allVncData.readUInt16BE(vncOffset);
                const srcY = allVncData.readUInt16BE(vncOffset + 2);
                vncOffset += 4;
                
                const copyBuf = Buffer.alloc(w * h * 4);
                for (let py = 0; py < h; py++) {
                    framebuffer.copy(copyBuf, py * w * 4, ((srcY + py) * width + srcX) * 4, ((srcY + py) * width + srcX + w) * 4);
                }
                for (let py = 0; py < h; py++) {
                    copyBuf.copy(framebuffer, ((y + py) * width + x) * 4, py * w * 4, (py + 1) * w * 4);
                }
                frameModified = true;
            } else {
                vncOffset = allVncData.length;
                break;
            }
        }
        
        if (frameModified) {
            frames.push(Buffer.from(framebuffer));
        }
    } else {
        break;
    }
}

console.log(`Extracted ${frames.length} frames`);

if (frames.length === 0) {
    console.error('No frames found');
    process.exit(1);
}

// Calculate fps
let fps = 10;
if (timestamps.length > 1) {
    const duration = timestamps[timestamps.length - 1] / 1000;
    if (duration > 0) fps = Math.max(1, Math.min(30, Math.round(frames.length / duration)));
}
console.log(`Using ${fps} fps`);

// Pipe frames directly to ffmpeg (no temp files)
console.log('Encoding video...');

const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '23',
    path.resolve(outputFile)
], { stdio: ['pipe', 'inherit', 'inherit'] });

// Write all frames to ffmpeg stdin
for (const frame of frames) {
    ffmpeg.stdin.write(frame);
}
ffmpeg.stdin.end();

ffmpeg.on('close', (code) => {
    if (code === 0) {
        console.log(`\nSaved: ${outputFile}`);
    } else {
        console.error(`ffmpeg failed with code ${code}`);
    }
});

