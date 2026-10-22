import fs from 'fs';

const sampleRate = 44100;
const duration = 0.6;
const numSamples = Math.floor(sampleRate * duration);
const buffer = Buffer.alloc(44 + numSamples * 2);

buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + numSamples * 2, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // Mono
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(numSamples * 2, 40);

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  // Pleasant two-tone chime: D5 (587.33Hz) then A5 (880.0Hz)
  const freq = t < 0.25 ? 587.33 : 880.0;
  const env = Math.exp(-6 * (t < 0.25 ? t : t - 0.25));
  const sample = Math.sin(2 * Math.PI * freq * t) * env * 0.45;
  buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
}

fs.writeFileSync('public/notification-sound.mp3', buffer);
console.log('Audio chime generated successfully. Size:', buffer.length);
