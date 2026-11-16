const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function makePng(width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  const rowBytes = 1 + width * 4;
  const rawData = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = 59;
      rawData[pxOffset + 1] = 130;
      rawData[pxOffset + 2] = 246;
      rawData[pxOffset + 3] = 255;
    }
  }

  const deflated = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crcNum = zlib.crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcNum, 0);

  return Buffer.concat([len, typeAndData, crcBuf]);
}

function makeIco(pngBuffers) {
  const png = pngBuffers[0];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 32;
  entry[1] = 32;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png]);
}

function makeIcns(pngBuffer) {
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write('ic07', 0, 4, 'ascii');
  chunkHeader.writeUInt32BE(8 + pngBuffer.length, 4);
  const chunk = Buffer.concat([chunkHeader, pngBuffer]);

  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write('icns', 0, 4, 'ascii');
  icnsHeader.writeUInt32BE(8 + chunk.length, 4);

  return Buffer.concat([icnsHeader, chunk]);
}

const iconsDir = path.resolve(__dirname, '../src-tauri/icons');
fs.mkdirSync(iconsDir, { recursive: true });

const png32 = makePng(32, 32);
const png128 = makePng(128, 128);
const png256 = makePng(256, 256);

fs.writeFileSync(path.join(iconsDir, '32x32.png'), png32);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), png128);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), png256);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), makeIco([png32]));
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), makeIcns(png128));

console.log('Icons generated successfully in', iconsDir);
