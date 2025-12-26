
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Wandelt rohe PCM-Daten (Int16, Little Endian) in ein AudioBuffer um.
 */
export async function pcmToAudioBuffer(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  if (data.byteLength === 0) return ctx.createBuffer(numChannels, 1, sampleRate);
  
  const frameCount = data.byteLength / (2 * numChannels);
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      const offset = (i * numChannels + channel) * 2;
      if (offset + 1 < data.byteLength) {
        // Skalierung von Int16 zu Float32 (-1.0 bis 1.0)
        channelData[i] = dataView.getInt16(offset, true) / 32768.0;
      }
    }
  }
  return buffer;
}

/**
 * Konvertiert Float32 Mikrofon-Input in Base64-PCM (Int16) für die Gemini API.
 */
export function createPCMBlob(data: Float32Array): string {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clipping auf -1.0 bis 1.0 begrenzen
    const s = Math.max(-1, Math.min(1, data[i]));
    // Umwandeln in 16-Bit Signed Integer
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return encodeBase64(new Uint8Array(int16.buffer));
}
